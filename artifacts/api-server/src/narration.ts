/**
 * ElevenLabs narration generator.
 * Converts per-scene story text to MP3 clips, pads each to exactly SCENE_DURATION_SEC,
 * inserts silence for title-card gaps, then concatenates everything into one MP3 that
 * is frame-accurate with the rendered video.
 */

import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

const AUDIO_DIR         = '/tmp/dreamstick-audio';
const SCENE_DURATION_SEC = 20;
const TITLE_CARD_FRAMES  = 20;
const FPS                = 30;
const TITLE_CARD_DUR_SEC = TITLE_CARD_FRAMES / FPS; // ≈ 0.667 s

const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1/text-to-speech';
const MODEL_ID = 'eleven_multilingual_v2';

// ── Helpers ───────────────────────────────────────────────────────────────────

function ffmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args);
    const err: string[] = [];
    proc.stderr.on('data', (d: Buffer) => err.push(d.toString()));
    proc.on('close', (code: number) =>
      code === 0
        ? resolve()
        : reject(new Error(`ffmpeg exit ${code}: ${err.join('').slice(-800)}`)),
    );
    proc.on('error', reject);
  });
}

/** Pad (or trim) audio to an exact duration in seconds. */
async function padToExact(inputPath: string, durationSec: number): Promise<string> {
  const outPath = inputPath.replace(/\.mp3$/, '-padded.mp3');
  await ffmpeg([
    '-i', inputPath,
    '-af', `apad=pad_dur=${durationSec},atrim=duration=${durationSec}`,
    '-c:a', 'libmp3lame', '-q:a', '2',
    '-y', outPath,
  ]);
  return outPath;
}

/** Generate a silent MP3 clip of the given duration. */
async function silenceClip(durationSec: number, tag: string): Promise<string> {
  const outPath = path.join(AUDIO_DIR, `silence-${tag}.mp3`);
  await ffmpeg([
    '-f', 'lavfi', '-i', `anullsrc=r=44100:cl=mono`,
    '-t', String(durationSec),
    '-c:a', 'libmp3lame', '-q:a', '2',
    '-y', outPath,
  ]);
  return outPath;
}

/** Concatenate an ordered list of MP3 files into one. */
async function concat(inputPaths: string[], outPath: string): Promise<void> {
  const inputs  = inputPaths.flatMap(p => ['-i', p]);
  const filter  =
    inputPaths.map((_, i) => `[${i}:a]`).join('') +
    `concat=n=${inputPaths.length}:v=0:a=1[out]`;
  await ffmpeg([
    ...inputs,
    '-filter_complex', filter,
    '-map', '[out]',
    '-c:a', 'libmp3lame', '-q:a', '2',
    '-y', outPath,
  ]);
}

/** Run async tasks with a max concurrency limit, preserving result order. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Call ElevenLabs TTS for a single piece of text.
 * Returns the path to the raw MP3 file.
 */
export async function generateSceneAudio(
  text: string,
  sceneIndex: number,
): Promise<string> {
  const apiKey  = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;

  if (!apiKey)  throw new Error('ELEVENLABS_API_KEY is not set');
  if (!voiceId) throw new Error('ELEVENLABS_VOICE_ID is not set');

  await fs.mkdir(AUDIO_DIR, { recursive: true });
  const outPath = path.join(AUDIO_DIR, `raw-scene${sceneIndex}-${Date.now()}.mp3`);

  const res = await fetch(`${ELEVENLABS_API_URL}/${encodeURIComponent(voiceId)}`, {
    method: 'POST',
    headers: {
      'xi-api-key':   apiKey,
      'Content-Type': 'application/json',
      'Accept':       'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: MODEL_ID,
      voice_settings: {
        stability:       0.5,
        similarity_boost: 0.75,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ElevenLabs API ${res.status}: ${body.slice(0, 300)}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(outPath, buf);
  console.log(`[narration] scene ${sceneIndex + 1} → ${(buf.length / 1024).toFixed(0)} KB`);
  return outPath;
}

/**
 * Generate narration audio for a full story (6 scenes).
 * Pads each scene to exactly 20 s, inserts silence for title-card gaps,
 * then concatenates into a single MP3 that is frame-accurate with the video.
 *
 * Timeline:
 *   [scene 1 audio 20 s] [silence 0.667 s] [scene 2 audio 20 s] … [scene 6 audio 20 s]
 *   = 120 s + 5 × 0.667 s ≈ 123.33 s  (exact match to video frame count)
 */
export async function generateStoryAudio(
  scenes: { narration: string }[],
): Promise<string> {
  await fs.mkdir(AUDIO_DIR, { recursive: true });
  const ts = Date.now();

  // 1. Generate scene audio with limited concurrency (ElevenLabs caps
  //    concurrent requests per plan — 3 is safe even on lower tiers)
  console.log('[narration] Generating audio for all scenes via ElevenLabs…');
  const rawPaths = await mapWithConcurrency(
    scenes, 3, (s, i) => generateSceneAudio(s.narration, i),
  );

  // 2. Pad / trim each scene to exactly SCENE_DURATION_SEC
  const paddedPaths = await Promise.all(
    rawPaths.map(p => padToExact(p, SCENE_DURATION_SEC)),
  );

  // 3. Generate one silence clip (reused between scenes)
  const silPath = await silenceClip(TITLE_CARD_DUR_SEC, String(ts));

  // 4. Interleave: scene0 + silence + scene1 + silence + … + scene5
  const allPaths: string[] = [];
  for (let i = 0; i < paddedPaths.length; i++) {
    allPaths.push(paddedPaths[i]);
    if (i < paddedPaths.length - 1) allPaths.push(silPath);
  }

  // 5. Concatenate
  const combinedPath = path.join(AUDIO_DIR, `narration-${ts}.mp3`);
  await concat(allPaths, combinedPath);
  console.log(`[narration] Combined narration → ${combinedPath}`);

  // 6. Clean up temp files (non-fatal)
  await Promise.allSettled(
    [...rawPaths, ...paddedPaths, silPath].map(p => fs.unlink(p)),
  );

  return combinedPath;
}
