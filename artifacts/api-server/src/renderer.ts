import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import type { Canvas, Image, SKRSContext2D } from '@napi-rs/canvas';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __rendererFilename = fileURLToPath(import.meta.url);
const __rendererDirname  = path.dirname(__rendererFilename);

/**
 * OpenMoji Black is bundled in artifacts/api-server/fonts/ so it works on any
 * OS (Replit, Railway, DigitalOcean Ubuntu) without apt-get installs.
 * The build script copies fonts/ into dist/fonts/ so the relative path works
 * from the compiled dist/index.mjs at runtime.
 */
const EMOJI_FONT_FAMILY = 'OpenMoji';
const EMOJI_FONT_PATH   = path.join(__dirname, 'fonts', 'OpenMoji-black-glyf.ttf');
try {
  const fontExists = existsSync(EMOJI_FONT_PATH);
  console.log(`[renderer] emoji font path: ${EMOJI_FONT_PATH} — exists: ${fontExists}`);
  if (fontExists) {
    GlobalFonts.registerFromPath(EMOJI_FONT_PATH, EMOJI_FONT_FAMILY);
    console.log('[renderer] emoji font registered OK');
  } else {
    console.error('[renderer] emoji font file NOT FOUND — sidekick emoji will be tofu');
  }
} catch (e) {
  console.error('[renderer] Failed to register emoji font:', e);
}
// Log all fonts @napi-rs/canvas can see (helps debug Arial / subtitle issues)
console.log('[renderer] registered font families:', GlobalFonts.families.map((f: { family: string }) => f.family).join(', ') || '(none)');

const W   = 540;
const H   = 960;
const OUT_W = 1080;
const OUT_H = 1920;
const FPS = 30;
const FRAMES_PER_SCENE  = 20 * FPS; // 600 frames = 20 s
const FADE_FRAMES       = 30;        // 1 s fade each side (scene-to-scene fade to black)
const TITLE_CARD_FRAMES = 20;        // title card between scenes

const VIDEOS_DIR        = '/tmp/dreamstick-videos';
const BG_FRAMES_DIR     = '/tmp/dreamstick-bg-frames';
const POSE_FRAMES_DIR   = '/tmp/dreamstick-pose-frames';
const PUBLIC_VIDEOS_DIR = path.join(__rendererDirname, '..', '..', 'dreamstick', 'public', 'videos');
const BACKGROUNDS_DIR   = path.join(__rendererDirname, '..', '..', 'dreamstick', 'public', 'backgrounds');
const CHARACTERS_DIR    = path.join(__rendererDirname, '..', '..', 'dreamstick', 'public', 'characters');

// 15 s clip covers 450 frames; the remaining 150 frames freeze the last frame
const BG_CLIP_FREEZE_FRAME = 450; // = 15 s × 30 fps

// Character layout — internal canvas is 540×960; ffmpeg upscales 2× to 1080×1920
// BASE dimensions used for pose-frame extraction (always at full resolution).
const BASE_CHAR_H      = 450;                              // 900 px in final output
const BASE_CHAR_W      = Math.round(BASE_CHAR_H * 0.558); // ≈ 251 px
const CHAR_BOTTOM      = 762;                              // feet stay at this Y always
const CHAR_CX          = W / 2;                            // 270 — horizontally centred

// Per-build scale factors { h: heightScale, w: widthScale }
const BUILD_SCALE: Record<string, { h: number; w: number }> = {
  tiny:    { h: 0.70, w: 1.00 },
  short:   { h: 0.82, w: 1.00 },
  average: { h: 1.00, w: 1.00 },
  tall:    { h: 1.20, w: 1.00 },
  big:     { h: 1.10, w: 1.18 },
};

/** Compute character draw dimensions from build, anchored at CHAR_BOTTOM. */
function charDims(build: string | undefined): {
  charH: number; charW: number; charTop: number; charCY: number;
} {
  const scale = BUILD_SCALE[build ?? 'average'] ?? BUILD_SCALE['average'];
  const charH   = Math.round(BASE_CHAR_H * scale.h);
  const charW   = Math.round(BASE_CHAR_W * scale.w);
  const charTop = CHAR_BOTTOM - charH;
  const charCY  = charTop + charH / 2;
  return { charH, charW, charTop, charCY };
}

// Narration box
const BOX_X = 18;
const BOX_W = W - 36;
// The box's bottom edge stays anchored near the bottom of the frame; its
// height grows upward to fit the full narration so long lines never spill
// out above the top edge. MIN/MAX bound how much it can shrink/grow.
const BOX_BOTTOM = 942;
const BOX_H_MIN  = 170;
const BOX_H_MAX  = 320;

const NAME_Y    = 52;
const GOLD      = '#f7e96b';
const GOLD_RGBA = 'rgba(247,233,107';

/**
 * Cache of pose-image + draw size → dark silhouette canvas.
 * Outer key: Image identity (same Image object = same raw pixels).
 * Inner key: "${w}x${h}" string so different build sizes get separate entries.
 */
const silhouetteCache = new WeakMap<Image, Map<string, Canvas>>();

function getCharacterSilhouette(pose: Image, w: number, h: number): Canvas {
  const sizeKey = `${w}x${h}`;
  let sizeMap = silhouetteCache.get(pose);
  if (sizeMap?.has(sizeKey)) return sizeMap.get(sizeKey)!;

  const sil = createCanvas(w, h);
  const sCtx = sil.getContext('2d');
  sCtx.drawImage(pose, 0, 0, w, h);
  sCtx.globalCompositeOperation = 'source-in';
  sCtx.fillStyle = 'rgba(8,6,18,0.95)';
  sCtx.fillRect(0, 0, w, h);

  if (!sizeMap) { sizeMap = new Map(); silhouetteCache.set(pose, sizeMap); }
  sizeMap.set(sizeKey, sil);
  return sil;
}

const SIDEKICK_MAP: Record<string, string> = {
  dragon: '🐉', cat: '🐱', dog: '🐶', rabbit: '🐰',
  robot: '🤖', unicorn: '🦄', owl: '🦉', fox: '🦊',
  parrot: '🦜', turtle: '🐢',
};

export type Mood = 'excited' | 'curious' | 'brave' | 'triumphant' | 'peaceful' | 'sleepy';

export interface RenderCharacter {
  child_name: string;
  character_type?: string;
  gender?: string;
  build?: string;
  hair_style?: string;
  hair_color?: string;
  outfit_color?: string;
  glow_color?: string;
  accessories?: string;
  sidekick?: string;
  theme?: string;
}

export interface RenderScene {
  scene_number: number;
  duration: number;
  narration: string;
  mood: string;
}

export interface RenderStory {
  title: string;
  scenes: RenderScene[];
}

// ── Pose loading ──────────────────────────────────────────────────────────────

type PoseSource =
  | { kind: 'image'; image: Image }
  | { kind: 'video'; framesDir: string; frameCount: number; _idx: number; _img: Image | null; frames: Image[] };

interface PoseSet {
  run: PoseSource; curious: PoseSource; heroic: PoseSource;
  triumph: PoseSource; peaceful: PoseSource; yawning: PoseSource; asleep: PoseSource;
}

/**
 * Global cap on concurrent ffmpeg extraction processes across the whole
 * render (poses + backgrounds combined). Each extraction is a full ffmpeg
 * decode/scale/re-encode pass, so running too many at once can exhaust
 * container memory. Acquire a slot before spawning, release when done.
 */
const MAX_CONCURRENT_EXTRACTIONS = 3;
let activeExtractions = 0;
const extractionWaiters: (() => void)[] = [];

async function acquireExtractionSlot(): Promise<void> {
  if (activeExtractions < MAX_CONCURRENT_EXTRACTIONS) {
    activeExtractions++;
    return;
  }
  await new Promise<void>(resolve => extractionWaiters.push(resolve));
  activeExtractions++;
}

function releaseExtractionSlot(): void {
  activeExtractions--;
  const next = extractionWaiters.shift();
  if (next) next();
}

async function extractVideoFramesLimited(
  videoPath: string, outDir: string, w: number, h: number,
): Promise<number> {
  await acquireExtractionSlot();
  try {
    return await extractVideoFrames(videoPath, outDir, w, h);
  } finally {
    releaseExtractionSlot();
  }
}

// ── Chroma-key tuning ─────────────────────────────────────────────────────────
// Adjust these two values to fix black-background removal on character clips.
//   COLORKEY_SIMILARITY — how close to black a pixel must be before it's cut.
//     Lower (e.g. 0.15) = less aggressive, preserves dark clothing/hair/shadows.
//     Higher (e.g. 0.40) = more aggressive, removes faint black fringe at edges.
//   COLORKEY_BLEND — softness of the keyed edge.
//     Lower (e.g. 0.05) = hard/sharp cut.  Higher (e.g. 0.20) = feathered edge.
const COLORKEY_SIMILARITY = 0.25;   // ← tune this first (was 0.30)
const COLORKEY_BLEND       = 0.15;  // ← tune this second (was 0.10)

/**
 * Extract frames from a character pose clip, keying out the black backdrop
 * via ffmpeg's `colorkey` filter so the frames come out as true RGBA PNGs
 * with a transparent background — composited onto the scene with normal alpha
 * blending. colorkey runs *before* the lanczos scale so the key isn't
 * fighting scaling-interpolation artifacts at edges.
 */
async function extractPoseFramesKeyed(
  videoPath: string, outDir: string, w: number, h: number,
): Promise<number> {
  await fs.mkdir(outDir, { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-i', videoPath,
      '-vf', `colorkey=black:${COLORKEY_SIMILARITY}:${COLORKEY_BLEND},scale=${w}:${h}:flags=lanczos,fps=${FPS},format=rgba`,
      '-y',
      path.join(outDir, 'frame%05d.png'),
    ]);
    const err: string[] = [];
    proc.stderr.on('data', (d: Buffer) => err.push(d.toString()));
    proc.on('close', (code: number) =>
      code === 0 ? resolve()
        : reject(new Error(`ffmpeg colorkey extract exit ${code}: ${err.join('').slice(-600)}`)),
    );
    proc.on('error', reject);
  });
  const files = await fs.readdir(outDir);
  return files.filter(f => f.endsWith('.png')).length;
}

async function extractPoseFramesKeyedLimited(
  videoPath: string, outDir: string, w: number, h: number,
): Promise<number> {
  await acquireExtractionSlot();
  try {
    return await extractPoseFramesKeyed(videoPath, outDir, w, h);
  } finally {
    releaseExtractionSlot();
  }
}

/** Load a single pose — prefers an animated MP4 clip (colorkeyed), falls back to a static PNG. */
async function loadPose(dir: string, name: string): Promise<PoseSource> {
  const mp4 = path.join(dir, `${name}.mp4`);
  try {
    await fs.access(mp4);
    const outDir = path.join(POSE_FRAMES_DIR, `${path.basename(dir)}-${name}-${BASE_CHAR_W}x${BASE_CHAR_H}`);
    // Reuse cached frames if they already exist (pose assets never change)
    let frameCount: number;
    let fromCache = false;
    try {
      const cached = await fs.readdir(outDir);
      frameCount = cached.filter(f => f.endsWith('.png')).length;
      if (frameCount > 0) { fromCache = true; }
    } catch { frameCount = 0; }
    if (!fromCache) {
      console.log(`[renderer] Extracting pose frames (colorkeyed): ${mp4}`);
      frameCount = await extractPoseFramesKeyedLimited(mp4, outDir, BASE_CHAR_W, BASE_CHAR_H);
      console.log(`[renderer] Extracted ${frameCount} pose frames for "${name}"`);
    } else {
      console.log(`[renderer] Using cached pose frames (${frameCount}) for "${name}"`);
    }
    // Pre-load all pose frames into memory so getPoseImage does zero disk I/O
    // during canvas rendering. Without this, the single-slot cache never hits
    // during cycling playback (consecutive idx values are always different),
    // meaning every canvas frame would call loadImage(PNG) from disk —
    // ~3,300 PNG reads for a 110-second render, taking ~1–1.5 h.
    // Pre-loading ~121 frames × 452 KB each ≈ 54 MB per pose (380 MB for 7 poses).
    console.log(`[renderer] Pre-loading ${frameCount} pose frames into memory for "${name}"`);
    const frames: Image[] = [];
    for (let i = 0; i < frameCount; i++) {
      frames.push(await loadImage(path.join(outDir, `frame${String(i + 1).padStart(5, '0')}.png`)));
    }
    return { kind: 'video', framesDir: outDir, frameCount, _idx: -1, _img: null, frames };
  } catch { /* no clip — fall back to PNG */ }
  return { kind: 'image', image: await loadImage(path.join(dir, `${name}.png`)) };
}

async function loadPoseSet(gender: 'boy' | 'girl'): Promise<PoseSet> {
  const dir  = path.join(CHARACTERS_DIR, gender);
  const [run, curious, heroic, triumph, peaceful, yawning, asleep] = await Promise.all([
    loadPose(dir, 'run'), loadPose(dir, 'curious'), loadPose(dir, 'heroic'), loadPose(dir, 'triumph'),
    loadPose(dir, 'peaceful'), loadPose(dir, 'yawning'), loadPose(dir, 'asleep'),
  ]);
  return { run, curious, heroic, triumph, peaceful, yawning, asleep };
}

function pickPose(mood: Mood, f: number, isLastScene: boolean, poses: PoseSet): PoseSource {
  if (isLastScene && f >= 450) return poses.asleep;  // switch to asleep at 15 s
  if (isLastScene)              return poses.yawning;
  switch (mood) {
    case 'excited':    return poses.run;
    case 'curious':    return poses.curious;
    case 'brave':      return poses.heroic;
    case 'triumphant': return poses.triumph;
    case 'peaceful':   return poses.peaceful;
    case 'sleepy':     return f >= 450 ? poses.asleep : poses.yawning;
  }
}

/**
 * Get the canvas Image for a pose at a given frame offset *within its own
 * pose segment* (0-based, resets whenever the pose changes). Animated poses
 * loop continuously (mod frameCount) rather than freezing, since the same
 * pose often spans an entire 20 s scene.
 */
async function getPoseImage(src: PoseSource, localFrame: number): Promise<Image> {
  if (src.kind === 'image') return src.image;
  const idx = localFrame % src.frameCount;
  // Frames are pre-loaded in loadPose — return directly from the array.
  // The same Image object is returned for the same idx on every cycle, so
  // silhouetteCache (WeakMap keyed by Image identity) now hits on the second
  // and all subsequent loops — eliminating per-frame silhouette canvas creation.
  return src.frames[idx];
}

// ── Particle system ───────────────────────────────────────────────────────────

interface Particle {
  spawnFrame: number;
  lifetime:   number;
  relX:       number;
  speedY:     number;
  size:       number;
  driftX:     number;
}

function seededRng(seed: number): () => number {
  let s = (seed * 6364136 + 1442695) | 0;
  return () => {
    s = Math.imul(1664525, s) + 1013904223;
    return (s >>> 0) / 0xffffffff;
  };
}

function createParticles(sceneIndex: number): Particle[] {
  const rng    = seededRng(sceneIndex + 7);
  const out: Particle[] = [];
  const chance = 15 / 75; // ~15 particles visible at once, ~75-frame avg life
  for (let f = 0; f < FRAMES_PER_SCENE; f++) {
    if (rng() < chance) {
      out.push({
        spawnFrame: f,
        lifetime:   Math.floor(rng() * 30) + 60,
        relX:       (rng() - 0.5) * BASE_CHAR_W * 1.8,
        speedY:     -(rng() * 1.6 + 0.5),
        size:        rng() * 2.5 + 1.5,
        driftX:     (rng() - 0.5) * 0.45,
      });
    }
  }
  return out;
}

function drawParticles(
  ctx: SKRSContext2D, particles: Particle[], f: number, charCY: number,
): void {
  ctx.save();
  for (const p of particles) {
    const age = f - p.spawnFrame;
    if (age < 0 || age >= p.lifetime) continue;
    const prog  = age / p.lifetime;
    const alpha = prog < 0.2 ? (prog / 0.2) * 0.7 : ((1 - prog) / 0.8) * 0.7;
    ctx.globalAlpha = alpha;
    ctx.fillStyle   = GOLD;
    ctx.shadowBlur  = 10;
    ctx.shadowColor = GOLD;
    ctx.beginPath();
    ctx.arc(
      CHAR_CX + p.relX + p.driftX * age,
      charCY + p.speedY * age,
      p.size, 0, Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.restore();
}

// ── Text helpers ──────────────────────────────────────────────────────────────

function wrapText(ctx: SKRSContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = word; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

/** Reveal words one at a time over the first 8 seconds of each scene. */
function getVisibleNarration(text: string, f: number): string {
  const words = text.split(' ');
  const ANIM_F = 240; // 8 s
  if (f >= ANIM_F) return text;
  const count = Math.max(1, Math.ceil((f / ANIM_F) * words.length));
  return words.slice(0, count).join(' ');
}

// ── Title card between scenes ─────────────────────────────────────────────────

function drawTitleCard(ctx: SKRSContext2D, nextScene: RenderScene, f: number): void {
  ctx.fillStyle = 'rgba(0,0,0,1)';
  ctx.fillRect(0, 0, W, H);

  const alpha = Math.min(
    f < FADE_FRAMES ? f / FADE_FRAMES : 1,
    f > TITLE_CARD_FRAMES - FADE_FRAMES
      ? 1 - (f - (TITLE_CARD_FRAMES - FADE_FRAMES)) / FADE_FRAMES : 1,
  );
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));

  ctx.strokeStyle = `${GOLD_RGBA},0.3)`;
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(W * 0.15, H / 2 - 38); ctx.lineTo(W * 0.85, H / 2 - 38);
  ctx.stroke();

  ctx.font         = 'bold 28px Arial, sans-serif';
  ctx.fillStyle    = GOLD;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowBlur   = 18;
  ctx.shadowColor  = GOLD;
  ctx.fillText(`Scene ${nextScene.scene_number}`, W / 2, H / 2 - 18);

  ctx.shadowBlur = 0;
  ctx.font       = '15px Arial, sans-serif';
  ctx.fillStyle  = 'rgba(255,255,255,0.65)';
  const teaser   = nextScene.narration.length > 38
    ? nextScene.narration.slice(0, 36) + '…' : nextScene.narration;
  ctx.fillText(teaser, W / 2, H / 2 + 18);

  ctx.strokeStyle = `${GOLD_RGBA},0.3)`;
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(W * 0.15, H / 2 + 38); ctx.lineTo(W * 0.85, H / 2 + 38);
  ctx.stroke();

  ctx.restore();
}

// ── Main frame draw (simple: character centred, no complex movement) ───────────

function drawFrame(
  ctx: SKRSContext2D,
  bg: Image,
  char: RenderCharacter,
  scene: RenderScene,
  pose: Image,
  particles: Particle[],
  f: number,
  fadeAlpha: number,
): void {
  const { charH, charW, charTop, charCY } = charDims(char.build);
  const charX = CHAR_CX - charW / 2;

  const glowHex = (char.glow_color ?? GOLD).replace('#', '');
  const gr = parseInt(glowHex.slice(0, 2), 16) || 247;
  const gg = parseInt(glowHex.slice(2, 4), 16) || 233;
  const gb = parseInt(glowHex.slice(4, 6), 16) || 107;

  // ── Background (centred, scaled to fill) ──
  const bgScale = Math.max(W / bg.width, H / bg.height);
  const bw = bg.width  * bgScale;
  const bh = bg.height * bgScale;
  ctx.drawImage(bg, (W - bw) / 2, (H - bh) / 2, bw, bh);

  // ── Vignette ──
  const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.28, W / 2, H / 2, H * 0.85);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,10,0.55)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);

  // ── Glow behind character ──
  const glow = ctx.createRadialGradient(CHAR_CX, charCY, 10, CHAR_CX, charCY, 210);
  glow.addColorStop(0, `rgba(${gr},${gg},${gb},0.28)`);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // ── Particles (behind character) ──
  drawParticles(ctx, particles, f, charCY);

  // ── Sidekick emoji — large, glowing, positioned to the right of and
  //    slightly behind the character. Drawn *before* the character pose so
  //    the character occludes the overlapping edge, giving it real depth
  //    instead of feeling pasted on top. ──
  const sk = (char.sidekick ?? '').toLowerCase();
  if (sk && sk !== 'none') {
    // SIDEKICK_MAP keys are words ('unicorn', 'cat'…). If the DB stored the
    // emoji directly (e.g. '🦄'), the word-lookup will miss — fall back to
    // the raw stored value before using the generic sparkle default.
    const emoji = SIDEKICK_MAP[sk] ?? char.sidekick?.trim() ?? '✨';
    const skX   = CHAR_CX + charW / 2 + 28;
    const skY   = charCY - charH * 0.12 + Math.sin(f / FPS * 2.3) * 8;

    ctx.save();
    // Very subtle soft glow behind the emoji — just enough to feel intentional.
    const skGlow = ctx.createRadialGradient(skX, skY, 4, skX, skY, 78);
    skGlow.addColorStop(0, `rgba(${gr},${gg},${gb},0.22)`);
    skGlow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = skGlow;
    ctx.fillRect(skX - 78, skY - 78, 156, 156);

    ctx.font         = `120px ${EMOJI_FONT_FAMILY}`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle    = '#fdfdfd';
    ctx.fillText(emoji, skX, skY);
    ctx.restore();
  }

  // ── Character outline/shadow — keeps the character readable against busy,
  //    colorful backgrounds regardless of what's behind it. Built from a
  //    dark silhouette of the pose's own alpha shape (not a generic box), so
  //    it hugs the character's actual outline. ──
  const silhouette = getCharacterSilhouette(pose, charW, charH);

  ctx.save();
  ctx.filter      = 'blur(7px)';
  ctx.globalAlpha = 0.4;
  ctx.drawImage(silhouette, charX, charTop + 5, charW, charH);
  ctx.restore();

  ctx.save();
  ctx.filter      = 'none';
  ctx.globalAlpha = 0.5;
  const OUTLINE_OFFSETS: Array<[number, number]> = [
    [-1.5, 0], [1.5, 0], [0, -1.5], [0, 1.5],
    [-1.1, -1.1], [1.1, -1.1], [-1.1, 1.1], [1.1, 1.1],
  ];
  for (const [dx, dy] of OUTLINE_OFFSETS) {
    ctx.drawImage(silhouette, charX + dx, charTop + dy, charW, charH);
  }
  ctx.restore();

  // ── Character pose — centred, real alpha transparency (colorkeyed PNG frames) ──
  ctx.save();
  ctx.drawImage(pose, charX, charTop, charW, charH);
  ctx.restore();

  // ── Child's name — gold at top ──
  ctx.save();
  ctx.font         = 'bold 36px Arial, sans-serif';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor  = GOLD;
  ctx.shadowBlur   = 14;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle    = GOLD;
  ctx.fillText(char.child_name, W / 2, NAME_Y);
  ctx.restore();

  // ── Narration box with word-by-word reveal ──
  // Size the box to the *full* narration (not just the partially-revealed
  // text) so it stays a stable size for the whole scene instead of growing
  // frame-by-frame as words appear. This guarantees every line — even for
  // long narrations — fits inside the box instead of spilling above the top.
  ctx.save();
  ctx.font       = '18px Arial, sans-serif';
  const lineH    = 24;
  const fullLines = wrapText(ctx, scene.narration, BOX_W - 28);
  const boxH = Math.min(BOX_H_MAX, Math.max(BOX_H_MIN, fullLines.length * lineH + 46));
  const boxY = BOX_BOTTOM - boxH;

  ctx.fillStyle = 'rgba(0,0,12,0.72)';
  ctx.beginPath();
  ctx.roundRect(BOX_X, boxY, BOX_W, boxH, 14);
  ctx.fill();
  ctx.strokeStyle = `${GOLD_RGBA},0.28)`;
  ctx.lineWidth   = 1;
  ctx.stroke();

  ctx.fillStyle    = 'rgba(255,255,255,0.96)';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'top';
  ctx.shadowBlur   = 4;
  ctx.shadowColor  = 'rgba(0,0,0,0.9)';
  ctx.shadowOffsetY = 1;

  const visibleText = getVisibleNarration(scene.narration, f);
  const lines   = wrapText(ctx, visibleText, BOX_W - 28);
  const totalTH = lines.length * lineH;
  const textY   = boxY + (boxH - 20 - totalTH) / 2;
  // Debug: log on frame 0 of each scene so we can verify font + text content
  if (f === 0) {
    console.log(`[renderer] subtitle draw f=0 scene=${scene.scene_number} font="${ctx.font}" fillStyle="${ctx.fillStyle}" lines=${JSON.stringify(lines)} textY=${textY}`);
  }
  lines.forEach((line, i) => ctx.fillText(line, W / 2, textY + i * lineH));
  ctx.restore();

  // ── Watermark + scene number ──
  ctx.save();
  ctx.font         = '10px Arial, sans-serif';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle    = `${GOLD_RGBA},0.40)`;
  ctx.textAlign    = 'center';
  ctx.fillText('✦ DreamStick Adventures', W / 2, boxY + boxH - 4);
  ctx.fillStyle = 'rgba(255,215,0,0.30)';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText(`Scene ${scene.scene_number} of 6`, W - 12, 12);
  ctx.restore();

  // ── Fade overlay ──
  if (fadeAlpha > 0) {
    ctx.fillStyle = `rgba(0,0,0,${Math.min(1, fadeAlpha)})`;
    ctx.fillRect(0, 0, W, H);
  }
}

// ── Background source (MP4 clip or static PNG) ───────────────────────────────

type BgSource =
  | { kind: 'image'; image: Image }
  | { kind: 'video'; framesDir: string; frameCount: number; _idx: number; _img: Image | null; sourcePath: string };

/**
 * Extract frames from an MP4 clip into JPEG files scaled to the given
 * width/height at the render frame rate. Returns the number of frames extracted.
 */
async function extractVideoFrames(
  videoPath: string, outDir: string, w: number, h: number,
): Promise<number> {
  await fs.mkdir(outDir, { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-i', videoPath,
      '-vf', `scale=${w}:${h}:flags=lanczos,fps=${FPS}`,
      '-q:v', '4',           // JPEG quality (1=best, 31=worst; 4 ≈ 85%)
      '-y',
      path.join(outDir, 'frame%05d.jpg'),
    ]);
    const err: string[] = [];
    proc.stderr.on('data', (d: Buffer) => err.push(d.toString()));
    proc.on('close', (code: number) =>
      code === 0 ? resolve()
        : reject(new Error(`ffmpeg frame-extract exit ${code}: ${err.join('').slice(-600)}`)),
    );
    proc.on('error', reject);
  });
  const files = await fs.readdir(outDir);
  return files.filter(f => f.endsWith('.jpg')).length;
}

/**
 * Get the canvas Image for a given scene-frame index.
 * Frames 0 → frameCount-1: the actual clip frame.
 * Frames frameCount → end:  the last clip frame (freeze).
 * Uses a single-slot cache since we always advance sequentially.
 */
async function getBgImage(src: BgSource, f: number): Promise<Image> {
  if (src.kind === 'image') return src.image;
  const idx = Math.min(f, src.frameCount - 1);
  if (src._idx === idx && src._img) return src._img;
  src._img = await loadImage(
    path.join(src.framesDir, `frame${String(idx + 1).padStart(5, '0')}.jpg`),
  );
  src._idx = idx;
  return src._img;
}

// ── Background loader ─────────────────────────────────────────────────────────

async function loadBg(theme: string, used: Set<number>): Promise<BgSource> {
  const dir       = path.join(BACKGROUNDS_DIR, theme.toLowerCase());
  const available = [1, 2, 3].filter(n => !used.has(n));
  const pick      = available.length > 0
    ? available[Math.floor(Math.random() * available.length)]
    : (Math.floor(Math.random() * 3) + 1);
  used.add(pick);

  // Try MP4 clip first (preferred: ~15 s looping clip)
  for (const n of [pick, 1, 2, 3]) {
    const mp4 = path.join(dir, `bg${n}.mp4`);
    try {
      await fs.access(mp4);
      const outDir = path.join(BG_FRAMES_DIR, `${theme}-bg${n}-${W}x${H}`);
      // Reuse cached frames if they already exist (bg assets never change)
      let frameCount: number;
      let fromCache = false;
      try {
        const cached = await fs.readdir(outDir);
        frameCount = cached.filter(f => f.endsWith('.jpg')).length;
        if (frameCount > 0) { fromCache = true; }
      } catch { frameCount = 0; }
      if (!fromCache) {
        console.log(`[renderer] Extracting bg frames: ${mp4}`);
        frameCount = await extractVideoFramesLimited(mp4, outDir, W, H);
        console.log(`[renderer] Extracted ${frameCount} bg frames`);
      } else {
        console.log(`[renderer] Using cached bg frames (${frameCount}) for ${mp4}`);
      }
      return { kind: 'video', framesDir: outDir, frameCount, _idx: -1, _img: null, sourcePath: mp4 };
    } catch { /* not found or extraction failed — try next */ }
  }

  // Fall back to static PNG
  for (const n of [pick, 1, 2, 3]) {
    try {
      return { kind: 'image', image: await loadImage(path.join(dir, `bg${n}.png`)) };
    } catch { /* next */ }
  }

  throw new Error(`No background assets for theme "${theme}" in ${dir}`);
}

// ── Background music (extracted from background video clips) ─────────────────

const AUDIO_TMP_DIR = '/tmp/dreamstick-audio';

/** Extract (or loop-extend) a background clip's audio track to exactly `durationSec` seconds. */
async function extractBgAudioSegment(
  videoPath: string, durationSec: number, outPath: string,
): Promise<boolean> {
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn('ffmpeg', [
        '-y',
        '-stream_loop', '-1',      // loop the source so short clips still cover long scenes
        '-i', videoPath,
        '-t', durationSec.toFixed(3),
        '-vn',
        '-ac', '2', '-ar', '44100',
        outPath,
      ]);
      const err: string[] = [];
      proc.stderr.on('data', (d: Buffer) => err.push(d.toString()));
      proc.on('close', (code: number) =>
        code === 0 ? resolve()
          : reject(new Error(`ffmpeg bg-audio-extract exit ${code}: ${err.join('').slice(-400)}`)),
      );
      proc.on('error', reject);
    });
    return true;
  } catch (e) {
    // Some background clips may have no audio track at all — that's fine,
    // we just skip music for that segment.
    console.warn(`[renderer] No usable audio in ${videoPath}, skipping bg music for this segment: ${(e as Error).message}`);
    return false;
  }
}

/** Generate a silent stereo WAV of the given duration (used for title-card gaps / missing bg audio). */
async function generateSilence(durationSec: number, outPath: string): Promise<void> {
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-y',
      '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
      '-t', Math.max(0.05, durationSec).toFixed(3),
      outPath,
    ]);
    const err: string[] = [];
    proc.stderr.on('data', (d: Buffer) => err.push(d.toString()));
    proc.on('close', (code: number) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg silence-gen exit ${code}: ${err.join('').slice(-400)}`)),
    );
    proc.on('error', reject);
  });
}

/** Concatenate a list of WAV segments (in order) into a single track. */
async function concatAudioSegments(segmentPaths: string[], outPath: string): Promise<void> {
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  const listPath = outPath.replace(/\.wav$/, '-list.txt');
  const listContent = segmentPaths.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
  await fs.writeFile(listPath, listContent, 'utf8');
  await new Promise<void>((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-y', '-f', 'concat', '-safe', '0', '-i', listPath,
      '-ac', '2', '-ar', '44100',
      outPath,
    ]);
    const err: string[] = [];
    proc.stderr.on('data', (d: Buffer) => err.push(d.toString()));
    proc.on('close', (code: number) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg concat exit ${code}: ${err.join('').slice(-400)}`)),
    );
    proc.on('error', reject);
  });
  await fs.unlink(listPath).catch(() => {});
}

/**
 * Build a single background-music track spanning the whole video (scenes +
 * title-card gaps), stitched together from each scene's own background clip
 * audio so the music timing tracks the visuals scene-by-scene.
 *
 * Fix B: all per-scene extractions and silence-gaps run concurrently via Promise.all.
 * Fix C: identical (sourcePath, duration) pairs are extracted once to a shared
 *         "dedup-N.wav"; any repeat occurrences copy from it instead of re-running ffmpeg.
 */
async function buildBackgroundMusicTrack(
  bgs: BgSource[], sceneDurationsSec: number[], titleCardGapSec: number, outPath: string,
): Promise<string | null> {
  const workDir = path.join(AUDIO_TMP_DIR, `bgmusic-${Date.now()}`);
  await fs.mkdir(workDir, { recursive: true });

  try {
    // Fix C: deduplicate — same (sourcePath, duration) extracts once to a shared
    // "dedup-N.wav"; any repeat references copy from that file instead of re-running ffmpeg.
    const extractCache = new Map<string, Promise<string | null>>();
    let dedupCount = 0;

    const getOrDedup = (sourcePath: string, duration: number): Promise<string | null> => {
      const key = `${sourcePath}::${duration.toFixed(3)}`;
      if (!extractCache.has(key)) {
        const dedupPath = path.join(workDir, `dedup-${dedupCount++}.wav`);
        extractCache.set(key, (async () => {
          const ok = await extractBgAudioSegment(sourcePath, duration, dedupPath);
          return ok ? dedupPath : null;
        })());
      }
      return extractCache.get(key)!;
    };

    // Build an ordered list of (segPath, work) pairs for every scene segment
    // and title-card gap. Fix B: all work fns run concurrently via Promise.all below.
    type SegWork = { segPath: string; run: () => Promise<boolean> };
    const segWorks: SegWork[] = [];

    for (let i = 0; i < bgs.length; i++) {
      const bg = bgs[i];
      const dur = sceneDurationsSec[i] ?? 20;
      const segPath = path.join(workDir, `seg${i}.wav`);

      if (bg.kind === 'video') {
        segWorks.push({
          segPath,
          run: async () => {
            const dedupPath = await getOrDedup(bg.sourcePath, dur);
            if (dedupPath) { await fs.copyFile(dedupPath, segPath); return true; }
            await generateSilence(dur, segPath);
            return false;
          },
        });
      } else {
        segWorks.push({ segPath, run: async () => { await generateSilence(dur, segPath); return false; } });
      }

      // Gap for the title card between this scene and the next
      if (i < bgs.length - 1) {
        const gapPath = path.join(workDir, `gap${i}.wav`);
        segWorks.push({ segPath: gapPath, run: async () => { await generateSilence(titleCardGapSec, gapPath); return false; } });
      }
    }

    // Fix B: run all segment extractions / silence generations in parallel
    const hasRealAudio = await Promise.all(segWorks.map(sw => sw.run()));
    if (!hasRealAudio.some(Boolean)) return null; // nothing to mix — every clip was silent

    await concatAudioSegments(segWorks.map(sw => sw.segPath), outPath);
    return outPath;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Mix background music under narration: narration stays at 100% volume,
 * background music is attenuated to 10% so it never competes with the
 * spoken story. Output duration matches the narration track (`duration=first`)
 * so a slightly-longer music bed never appends silence to the end.
 * normalize=0 prevents amix from boosting the mix to compensate for the
 * quiet music track, which would otherwise lift the overall level.
 */
async function mixNarrationWithMusic(
  narrationPath: string, musicPath: string, outPath: string,
): Promise<void> {
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-y',
      '-i', narrationPath,
      '-i', musicPath,
      '-filter_complex',
      '[0:a]volume=1.0[narr];[1:a]volume=0.10[music];[narr][music]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]',
      '-map', '[aout]',
      '-ac', '2', '-ar', '44100',
      outPath,
    ]);
    const err: string[] = [];
    proc.stderr.on('data', (d: Buffer) => err.push(d.toString()));
    proc.on('close', (code: number) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg mix exit ${code}: ${err.join('').slice(-600)}`)),
    );
    proc.on('error', reject);
  });
}

// ── Merge audio into video ────────────────────────────────────────────────────

async function mergeAudio(videoPath: string, audioPath: string, outPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-y',
      '-i', videoPath,
      '-i', audioPath,
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      outPath,
    ]);
    const err: string[] = [];
    proc.stderr.on('data', (d: Buffer) => err.push(d.toString()));
    proc.on('close', (code: number) =>
      code === 0
        ? resolve()
        : reject(new Error(`ffmpeg audio-merge exit ${code}: ${err.join('').slice(-600)}`)),
    );
    proc.on('error', reject);
  });
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function renderVideo(
  char: RenderCharacter,
  story: RenderStory,
  audioPath?: string,
  sceneDurationsSec?: number[],
): Promise<string> {
  await fs.mkdir(VIDEOS_DIR, { recursive: true });

  const safeName = char.child_name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const outPath  = path.join(VIDEOS_DIR, `${safeName}-${Date.now()}.mp4`);
  const theme    = (char.theme ?? 'space').toLowerCase();
  const gender: 'boy' | 'girl' =
    ((char.gender ?? char.character_type) === 'girl') ? 'girl' : 'boy';

  const [poses, bgs] = await Promise.all([
    loadPoseSet(gender),
    (async () => {
      const used = new Set<number>();
      const srcs: BgSource[] = [];
      for (let i = 0; i < story.scenes.length; i++)
        srcs.push(await loadBg(theme, used));
      return srcs;
    })(),
  ]);

  // Per-scene frame counts — computed here (before the canvas loop) so that
  // bgMusicPromise can start immediately using the same scene-duration data.
  const framesPerScene: number[] = story.scenes.map((_, i) => {
    const durSec = sceneDurationsSec?.[i] ?? 20;
    return Math.round(durSec * FPS);
  });
  const titleCardGapSec = TITLE_CARD_FRAMES / FPS;

  // Fix A: kick off background music extraction NOW — it only needs bgs[] and
  // scene durations, both available at this point. It runs in parallel with the
  // entire canvas rendering loop so audio is completely off the critical path.
  // We only await the result after `await done` (when ffmpeg finishes encoding).
  const musicWorkDir = path.join(AUDIO_TMP_DIR, `render-${Date.now()}`);
  const musicTrackPath = path.join(musicWorkDir, 'music.wav');
  const bgMusicPromise: Promise<string | null> = audioPath
    ? buildBackgroundMusicTrack(bgs, framesPerScene.map(fr => fr / FPS), titleCardGapSec, musicTrackPath)
        .catch((e: unknown) => {
          console.error('[renderer] Background music prep failed:', (e as Error).message);
          return null;
        })
    : Promise.resolve(null);

  const ff = spawn('ffmpeg', [
    '-y', '-f', 'rawvideo', '-pixel_format', 'rgba',
    '-video_size', `${W}x${H}`, '-framerate', String(FPS), '-i', 'pipe:0',
    '-vf', `scale=${OUT_W}:${OUT_H}:flags=lanczos`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-crf', '22', '-preset', 'veryfast', '-movflags', '+faststart',
    outPath,
  ]);

  const ffErrors: string[] = [];
  ff.stderr.on('data', (d: Buffer) => ffErrors.push(d.toString()));
  const done = new Promise<void>((resolve, reject) => {
    ff.on('close', (code: number) =>
      code === 0 ? resolve()
        : reject(new Error(`ffmpeg exit ${code}: ${ffErrors.join('').slice(-800)}`)),
    );
    ff.on('error', reject);
  });

  const canvas      = createCanvas(W, H);
  const ctx         = canvas.getContext('2d');
  const totalScenes = story.scenes.length;

  const writeFrame = async () => {
    // Use canvas.data() (a direct raw-pixel Buffer) instead of
    // ctx.getImageData(), which allocates a brand-new ImageData wrapper
    // object (and native pixel copy) on every call. Across a multi-thousand
    // -frame render, getImageData()'s allocations outpaced what periodic GC
    // could reclaim and OOM-killed the process; canvas.data() avoids the
    // extra wrapper entirely.
    const ok = ff.stdin.write(canvas.data());
    if (!ok) await new Promise<void>(r => ff.stdin.once('drain', r));
  };

  // Both bg and pose frame dirs are persistent caches — never deleted between renders.
  // They persist for the life of the process so subsequent renders skip extraction entirely.
  const tempDirs: string[] = [];

  // Tracks when the current pose started so animated clips loop from frame 0
  // whenever the pose changes. Uses a monotonic globalFrame counter so it stays
  // correct across scenes of variable length.
  let lastPoseSrc: PoseSource | null = null;
  let poseStartFrame = 0;
  let globalFrame = 0;

  try {
    for (let si = 0; si < totalScenes; si++) {
      const scene         = story.scenes[si];
      const bgSrc         = bgs[si];
      const isLastScene   = si === totalScenes - 1;
      const mood          = scene.mood as Mood;
      const particles     = createParticles(si);
      const sceneFrames   = framesPerScene[si];

      // ── Scene frames ──────────────────────────────────────────────────────
      for (let f = 0; f < sceneFrames; f++) {
        let fadeAlpha = 0;

        // Fade in from title card
        if (si > 0 && f < FADE_FRAMES)
          fadeAlpha = 1 - f / FADE_FRAMES;

        // Fade out to next title card
        if (!isLastScene && f >= sceneFrames - FADE_FRAMES)
          fadeAlpha = (f - (sceneFrames - FADE_FRAMES)) / FADE_FRAMES;

        // Final scene fades to black over last 2 s
        if (isLastScene && f >= sceneFrames - FADE_FRAMES * 3)
          fadeAlpha = (f - (sceneFrames - FADE_FRAMES * 3)) / (FADE_FRAMES * 3);

        // For video bg: frames 0-449 play the clip; beyond that freeze last frame
        const bgImage = await getBgImage(bgSrc, Math.min(f, BG_CLIP_FREEZE_FRAME - 1));

        const poseSrc = pickPose(mood, f, isLastScene, poses);
        if (poseSrc !== lastPoseSrc) {
          lastPoseSrc = poseSrc;
          poseStartFrame = globalFrame;
        }
        const poseLocalFrame = globalFrame - poseStartFrame;
        const poseImage = await getPoseImage(poseSrc, poseLocalFrame);

        drawFrame(ctx, bgImage, char, scene, poseImage, particles, f,
                  Math.min(1, Math.max(0, fadeAlpha)));
        await writeFrame();

        // @napi-rs/canvas allocates native pixel buffers on every
        // getImageData() call. V8's GC scheduling is driven by JS heap
        // pressure, which stays tiny here (we only hold small objects on
        // the JS side), so it under-collects the ballooning native/external
        // memory and the process gets OOM-killed over a multi-thousand-frame
        // render. Nudge a GC pass periodically to keep native memory bounded.
        if (typeof global.gc === 'function' && globalFrame % 60 === 0) {
          global.gc();
        }
        globalFrame++;
      }

      // ── Title card between scenes ─────────────────────────────────────────
      if (!isLastScene) {
        const nextScene = story.scenes[si + 1];
        // Use the last bg frame for the title card black overlay
        const bgImage = await getBgImage(bgSrc, BG_CLIP_FREEZE_FRAME - 1);
        for (let f = 0; f < TITLE_CARD_FRAMES; f++) {
          drawTitleCard(ctx, nextScene, f);
          await writeFrame();
          globalFrame++;
        }
        void bgImage; // suppress unused warning
      }
    }
  } finally {
    ff.stdin.end();
    // Clean up extracted bg frame directories (non-fatal)
    await Promise.allSettled(
      tempDirs.map(d => fs.rm(d, { recursive: true, force: true })),
    );
  }

  await done;

  // ── Merge narration audio (+ background music) if provided ───────────────
  let finalPath = outPath;
  if (audioPath) {
    finalPath = outPath.replace(/\.mp4$/, '-narrated.mp4');

    // Fix A: bgMusicPromise was started before the canvas loop and has been
    // running in parallel — just await its already-completed (or near-complete) result.
    let mixedAudioPath = audioPath;
    try {
      const musicPath = await bgMusicPromise;
      if (musicPath) {
        console.log('[renderer] Mixing background music (15%) under narration (100%)…');
        const mixedPath = path.join(musicWorkDir, 'mixed.wav');
        await mixNarrationWithMusic(audioPath, musicPath, mixedPath);
        mixedAudioPath = mixedPath;
      } else {
        console.warn('[renderer] No background audio available — using narration only');
      }
    } catch (e) {
      console.error('[renderer] Background music mixing failed, falling back to narration only:', (e as Error).message);
    }

    console.log('[renderer] Merging final audio track…');
    await mergeAudio(outPath, mixedAudioPath, finalPath);
    await fs.unlink(outPath).catch(() => {});
    if (mixedAudioPath !== audioPath) {
      await fs.rm(path.dirname(mixedAudioPath), { recursive: true, force: true }).catch(() => {});
    }
    console.log('[renderer] Audio merged → ' + finalPath);
  }

  try {
    await fs.mkdir(PUBLIC_VIDEOS_DIR, { recursive: true });
    await fs.copyFile(finalPath, path.join(PUBLIC_VIDEOS_DIR, path.basename(finalPath)));
  } catch { /* non-fatal */ }

  return finalPath;
}
