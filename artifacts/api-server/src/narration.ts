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

/** Return the duration of an audio file in seconds using ffprobe. */
async function probeDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath,
    ]);
    let out = '';
    proc.stdout.on('data', (d: Buffer) => { out += d.toString(); });
    proc.on('close', (code: number) => {
      if (code !== 0) return reject(new Error(`ffprobe exit ${code}`));
      const dur = parseFloat(out.trim());
      if (isNaN(dur)) return reject(new Error(`ffprobe bad output: "${out}"`));
      resolve(dur);
    });
    proc.on('error', reject);
  });
}

/** Pad audio to at least targetSec — never trims if already longer. */
async function padToAtLeast(inputPath: string, targetSec: number): Promise<string> {
  const outPath = inputPath.replace(/\.mp3$/, '-padded.mp3');
  await ffmpeg([
    '-i', inputPath,
    '-af', `apad=pad_dur=${targetSec}`,
    '-t', String(targetSec),
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

const MIN_SCENE_SEC   = 15;   // floor so very short scenes don't feel rushed
const AUDIO_BUFFER_SEC = 1.0;  // silence pad after narration ends before cut

/**
 * Generate narration audio for a full story (6 scenes).
 * Each scene's duration is driven by its actual ElevenLabs output — scenes
 * that take longer than the old 20 s fixed window are no longer cut off.
 *
 * Returns both the combined MP3 path and the per-scene duration array so
 * the renderer can set the matching frame count for each scene.
 *
 * Timeline:
 *   [scene 1 audio + buffer] [silence 0.667 s] [scene 2 audio + buffer] … [scene N]
 */
export async function generateStoryAudio(
  scenes: { narration: string }[],
): Promise<{ audioPath: string; sceneDursSec: number[] }> {
  await fs.mkdir(AUDIO_DIR, { recursive: true });
  const ts = Date.now();

  // 1. Generate scene audio with limited concurrency
  console.log('[narration] Generating audio for all scenes via ElevenLabs…');
  const rawPaths = await mapWithConcurrency(
    scenes, 3, (s, i) => generateSceneAudio(s.narration, i),
  );

  // 2. Measure actual duration of each raw clip, then compute padded duration
  const rawDurs = await Promise.all(rawPaths.map(p => probeDuration(p)));
  const sceneDursSec = rawDurs.map(d =>
    Math.max(MIN_SCENE_SEC, Math.ceil(d + AUDIO_BUFFER_SEC)),
  );
  console.log(`[narration] Per-scene durations (s): ${sceneDursSec.join(', ')}`);

  // 3. Pad each scene to its computed duration (never trims)
  const paddedPaths = await Promise.all(
    rawPaths.map((p, i) => padToAtLeast(p, sceneDursSec[i])),
  );

  // 4. Generate one silence clip (reused between scenes)
  const silPath = await silenceClip(TITLE_CARD_DUR_SEC, String(ts));

  // 5. Interleave: scene0 + silence + scene1 + silence + … + sceneN
  const allPaths: string[] = [];
  for (let i = 0; i < paddedPaths.length; i++) {
    allPaths.push(paddedPaths[i]);
    if (i < paddedPaths.length - 1) allPaths.push(silPath);
  }

  // 6. Concatenate
  const combinedPath = path.join(AUDIO_DIR, `narration-${ts}.mp3`);
  await concat(allPaths, combinedPath);
  console.log(`[narration] Combined narration → ${combinedPath}`);

  // 7. Clean up temp files (non-fatal)
  await Promise.allSettled(
    [...rawPaths, ...paddedPaths, silPath].map(p => fs.unlink(p)),
  );

  return { audioPath: combinedPath, sceneDursSec };
}
