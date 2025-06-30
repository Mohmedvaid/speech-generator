import fs from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { GoogleGenAI } from "@google/genai";

/* --------------------------------------------------------------------------
   src/tts-gemini.js  –  Single‑speaker TTS via Gemini 2.5 API
   --------------------------------------------------------------------------
   Matches Google’s guide exactly, but prepends a style cue to the text so the
   model speaks in the requested tone ("Slightly dramatic storyteller with a
   slight British accent", etc.).

   ENV (.env)
   --------------------------------------------------------------------------
     GEMINI_API_KEY       ← required
     GEMINI_TTS_MODEL     ← gemini-2.5-flash-preview-tts | gemini-2.5-pro-preview-tts
     GEMINI_VOICE         ← "Charon", "Kore", "Puck", etc.
     GEMINI_STYLE         ← optional style prefix (default below)
  -------------------------------------------------------------------------- */

config();

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error("ERROR: GEMINI_API_KEY missing in .env");
  process.exit(1);
}

const MODEL = process.env.GEMINI_TTS_MODEL || "gemini-2.5-flash-preview-tts";
const VOICE = process.env.GEMINI_VOICE || "Iapetus";
const STYLE =
  process.env.GEMINI_STYLE ||
  "Neutral storyteller with a mild British accent and a very slight dramatic tone";

const USAGE = "\nUsage: node src/tts-gemini.js <input.txt> <output.wav>\n";
const [, , inFile, outFile] = process.argv;
if (!inFile || !outFile) {
  console.error(USAGE);
  process.exit(1);
}

const absIn = path.resolve(inFile);
const absOut = path.resolve(outFile);
if (!fs.existsSync(absIn)) {
  console.error(`ERROR: input file not found → ${absIn}`);
  process.exit(1);
}

const rawText = fs.readFileSync(absIn, "utf8").trim();
if (!rawText) {
  console.error("ERROR: input file is empty");
  process.exit(1);
}

// Prepend style cue so the model follows tone instructions.
const text = `${STYLE}:\n${rawText}`;

// ----------- helper: write WAV file ---------------------------------------
function saveWav(filename, pcm, sampleRate = 24000) {
  const header = Buffer.alloc(44);
  const bytesPerSample = 2;
  const byteRate = sampleRate * bytesPerSample;
  const dataSize = pcm.length;

  header.write("RIFF", 0, 4, "ascii");
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8, 4, "ascii");
  header.write("fmt ", 12, 4, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(bytesPerSample, 32);
  header.writeUInt16LE(8 * bytesPerSample, 34);
  header.write("data", 36, 4, "ascii");
  header.writeUInt32LE(dataSize, 40);

  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, Buffer.concat([header, pcm]));
}

(async () => {
  console.log(`Generating TTS…  model=${MODEL}  voice=${VOICE}`);

  const ai = new GoogleGenAI({ apiKey: API_KEY });

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [{ parts: [{ text }] }],
    config: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: VOICE },
        },
      },
    },
  });

  const base64 =
    response?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64) {
    console.error("ERROR: no audio returned – check model & voice names");
    process.exit(1);
  }

  const pcm = Buffer.from(base64, "base64");
  saveWav(absOut, pcm);

  console.log(`\n✔ Saved → ${absOut}`);
})().catch((err) => {
  console.error("Generation failed:", err);
  process.exit(1);
});
