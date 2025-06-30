import fs from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import OpenAI from "openai";

/* --------------------------------------------------------------------------
   OpenAI‑TTS CLI  •  src/tts.js
   --------------------------------------------------------------------------
   Converts a text file to narrated audio using either
     •  tts‑1‑hd       (higher fidelity, fixed voices)   ‑‑ default
     •  gpt‑4o-mini‑tts (instruction‑driven voice)

   Environment (.env):
     OPENAI_API_KEY   required
     TTS_MODEL        tts-1-hd | gpt-4o-mini-tts        (default: tts-1-hd)
     TTS_VOICE        alloy | fable | nova | shimmer... (tts‑1* only)
     TTS_SPEED        float 0.5‑2.0                     (tts‑1* only, default 0.9)
     TTS_INSTR        free text style prompt            (4o‑mini only)
  -------------------------------------------------------------------------- */

config();

const USAGE = `\nUsage: node src/tts.js <input.txt> <output.wav>\n`;

const MODEL = process.env.TTS_MODEL || "tts-1-hd";
const VOICE = process.env.TTS_VOICE || "fable";
const SPEED = parseFloat(process.env.TTS_SPEED || "1.0");
const INSTR = process.env.TTS_INSTR || "Calm, slightly dramatic storyteller.";

const HEADER_BYTES = 44; // standard PCM/WAV header length

async function main() {
  const [, , inFile, outFile] = process.argv;

  if (!process.env.OPENAI_API_KEY) {
    console.error("ERROR: OPENAI_API_KEY missing in .env");
    process.exit(1);
  }
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

  const text = fs.readFileSync(absIn, "utf8").trim();
  if (!text) {
    console.error("ERROR: input file is empty");
    process.exit(1);
  }

  const client = new OpenAI();

  const CHUNK_LEN = 8000;
  const chunks = [];
  for (let i = 0; i < text.length; i += CHUNK_LEN) {
    chunks.push(text.slice(i, i + CHUNK_LEN));
  }

  // ensure output directory exists
  fs.mkdirSync(path.dirname(absOut), { recursive: true });
  const out = fs.createWriteStream(absOut);

  try {
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      console.log(`(TTS) chunk ${i + 1}/${chunks.length}`);

      const baseParams = {
        model: MODEL,
        input: chunk,
        format: "wav",
      };

      const params =
        MODEL === "gpt-4o-mini-tts"
          ? { ...baseParams, instructions: INSTR }
          : { ...baseParams, voice: VOICE, speed: SPEED };

      const response = await client.audio.speech.create(params);

      const buffer = Buffer.from(await response.arrayBuffer());
      if (i === 0) {
        out.write(buffer);
      } else {
        // skip WAV header on subsequent chunks
        out.write(buffer.slice(HEADER_BYTES));
      }
    }
  } catch (err) {
    console.error("TTS generation failed:", err);
    if (fs.existsSync(absOut)) fs.unlinkSync(absOut);
    process.exit(1);
  } finally {
    out.end();
  }

  console.log(`\n✔ Success → ${absOut}`);
  console.log(
    `   Model : ${MODEL}${
      MODEL.startsWith("tts") ? ` | voice: ${VOICE} | speed: ${SPEED}` : ""
    }`
  );
}

main();
