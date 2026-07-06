import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import type { Image, SKRSContext2D } from '@napi-rs/canvas';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __rendererFilename = fileURLToPath(import.meta.url);
const __rendererDirname  = path.dirname(__rendererFilename);

/**
 * The base OS image has no emoji-capable fonts installed (only DejaVu), so
 * sidekick emoji were silently rendering as blank "tofu" glyphs. OpenMoji
 * Black is a monochrome outline emoji font (glyf-based, not a COLR/CBDT
 * color font), which @napi-rs/canvas can rasterize reliably — registered
 * directly from its Nix store path since fontconfig hasn't indexed
 * newly-added Nix packages without a full container rebuild.
 */
const EMOJI_FONT_FAMILY = 'OpenMoji';
try {
  GlobalFonts.registerFromPath(
    '/nix/store/bryizcnj2q42wxjw7sm85z8jncckgvs1-openmoji-15.1.0/share/fonts/truetype/OpenMoji-black-glyf.ttf',
    EMOJI_FONT_FAMILY,
  );
} catch (e) {
  console.error('[renderer] Failed to register emoji font, sidekick emoji may not render:', e);
}

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
const CHAR_H        = 450;                         // 900 px in final output
const CHAR_W        = Math.round(CHAR_H * 0.558);  // ≈ 251 px
const CHAR_BOTTOM   = 762;
const CHAR_TOP      = CHAR_BOTTOM - CHAR_H;        // ≈ 312
const CHAR_CX       = W / 2;                       // 270 — horizontally centred
const CHAR_CY       = CHAR_TOP + CHAR_H / 2;       // ≈ 537

// Narration box
const BOX_X = 18;
const BOX_Y = 772;
const BOX_W = W - 36;
const BOX_H = 170;

const NAME_Y    = 52;
const GOLD      = '#f7e96b';
const GOLD_RGBA = 'rgba(247,233,107';

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
  | { kind: 'video'; framesDir: string; frameCount: number; _idx: number; _img: Image | null };

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

/**
 * Extract frames from a character pose clip, keying out the black backdrop
 * via ffmpeg's `colorkey` filter (color=black similarity=0.3 blend=0.1) so
 * the frames come out as true RGBA PNGs with a transparent background —
 * composited onto the scene with normal alpha blending instead of relying
 * on a 'screen' blend-mode approximation. colorkey runs *before* the lanczos
 * scale so the key isn't fighting scaling-interpolation artifacts at edges.
 */
async function extractPoseFramesKeyed(
  videoPath: string, outDir: string, w: number, h: number,
): Promise<number> {
  await fs.mkdir(outDir, { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-i', videoPath,
      '-vf', `colorkey=black:0.3:0.1,scale=${w}:${h}:flags=lanczos,fps=${FPS},format=rgba`,
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
    const outDir = path.join(POSE_FRAMES_DIR, `${path.basename(dir)}-${name}-${Date.now()}`);
    console.log(`[renderer] Extracting pose frames (colorkeyed): ${mp4}`);
    const frameCount = await extractPoseFramesKeyedLimited(mp4, outDir, CHAR_W, CHAR_H);
    console.log(`[renderer] Extracted ${frameCount} pose frames for "${name}"`);
    return { kind: 'video', framesDir: outDir, frameCount, _idx: -1, _img: null };
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
  if (src._idx === idx && src._img) return src._img;
  src._img = await loadImage(
    path.join(src.framesDir, `frame${String(idx + 1).padStart(5, '0')}.png`),
  );
  src._idx = idx;
  return src._img;
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
        relX:       (rng() - 0.5) * CHAR_W * 1.8,
        speedY:     -(rng() * 1.6 + 0.5),
        size:        rng() * 2.5 + 1.5,
        driftX:     (rng() - 0.5) * 0.45,
      });
    }
  }
  return out;
}

function drawParticles(
  ctx: SKRSContext2D, particles: Particle[], f: number,
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
      CHAR_CY + p.speedY * age,
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
  const glow = ctx.createRadialGradient(CHAR_CX, CHAR_CY, 10, CHAR_CX, CHAR_CY, 210);
  glow.addColorStop(0, `rgba(${gr},${gg},${gb},0.28)`);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // ── Particles (behind character) ──
  drawParticles(ctx, particles, f);

  // ── Character pose — centred, real alpha transparency (colorkeyed PNG frames) ──
  ctx.save();
  ctx.drawImage(pose, CHAR_CX - CHAR_W / 2, CHAR_TOP, CHAR_W, CHAR_H);
  ctx.restore();

  // ── Sidekick emoji — bobs gently to the right of the character ──
  const sk = (char.sidekick ?? '').toLowerCase();
  if (sk && sk !== 'none') {
    const emoji  = SIDEKICK_MAP[sk] ?? '✨';
    const skX    = Math.min(W - 28, CHAR_CX + CHAR_W / 2 + 32);
    const skY    = CHAR_CY - CHAR_H * 0.18 + Math.sin(f / FPS * 2.3) * 8;
    ctx.save();
    ctx.font = `34px ${EMOJI_FONT_FAMILY}`;
    ctx.fillStyle    = GOLD;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, skX, skY);
    ctx.restore();
  }

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
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,12,0.72)';
  ctx.beginPath();
  ctx.roundRect(BOX_X, BOX_Y, BOX_W, BOX_H, 14);
  ctx.fill();
  ctx.strokeStyle = `${GOLD_RGBA},0.28)`;
  ctx.lineWidth   = 1;
  ctx.stroke();

  ctx.font         = '18px Arial, sans-serif';
  ctx.fillStyle    = 'rgba(255,255,255,0.96)';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'top';
  ctx.shadowBlur   = 4;
  ctx.shadowColor  = 'rgba(0,0,0,0.9)';
  ctx.shadowOffsetY = 1;

  const visibleText = getVisibleNarration(scene.narration, f);
  const lineH   = 24;
  const lines   = wrapText(ctx, visibleText, BOX_W - 28);
  const totalTH = lines.length * lineH;
  const textY   = BOX_Y + (BOX_H - 20 - totalTH) / 2;
  lines.forEach((line, i) => ctx.fillText(line, W / 2, textY + i * lineH));
  ctx.restore();

  // ── Watermark + scene number ──
  ctx.save();
  ctx.font         = '10px Arial, sans-serif';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle    = `${GOLD_RGBA},0.40)`;
  ctx.textAlign    = 'center';
  ctx.fillText('✦ DreamStick Adventures', W / 2, BOX_Y + BOX_H - 4);
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
  | { kind: 'video'; framesDir: string; frameCount: number; _idx: number; _img: Image | null };

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
      const outDir = path.join(BG_FRAMES_DIR, `${theme}-bg${n}-${Date.now()}`);
      console.log(`[renderer] Extracting bg frames: ${mp4}`);
      const frameCount = await extractVideoFramesLimited(mp4, outDir, W, H);
      console.log(`[renderer] Extracted ${frameCount} bg frames`);
      return { kind: 'video', framesDir: outDir, frameCount, _idx: -1, _img: null };
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

  const tempDirs: string[] = [
    ...bgs
      .filter((b): b is Extract<BgSource, { kind: 'video' }> => b.kind === 'video')
      .map(b => b.framesDir),
    ...Object.values(poses)
      .filter((p): p is Extract<PoseSource, { kind: 'video' }> => p.kind === 'video')
      .map(p => p.framesDir),
  ];

  // Tracks when the current pose started, so animated pose clips loop from
  // frame 0 each time the pose changes (rather than continuing a stale offset).
  let lastPoseSrc: PoseSource | null = null;
  let poseStartFrame = 0;

  try {
    for (let si = 0; si < totalScenes; si++) {
      const scene       = story.scenes[si];
      const bgSrc       = bgs[si];
      const isLastScene = si === totalScenes - 1;
      const mood        = scene.mood as Mood;
      const particles   = createParticles(si);

      // ── Scene frames ──────────────────────────────────────────────────────
      for (let f = 0; f < FRAMES_PER_SCENE; f++) {
        let fadeAlpha = 0;

        // Fade in from title card
        if (si > 0 && f < FADE_FRAMES)
          fadeAlpha = 1 - f / FADE_FRAMES;

        // Fade out to next title card
        if (!isLastScene && f >= FRAMES_PER_SCENE - FADE_FRAMES)
          fadeAlpha = (f - (FRAMES_PER_SCENE - FADE_FRAMES)) / FADE_FRAMES;

        // Final scene fades to black over last 2 s
        if (isLastScene && f >= FRAMES_PER_SCENE - FADE_FRAMES * 3)
          fadeAlpha = (f - (FRAMES_PER_SCENE - FADE_FRAMES * 3)) / (FADE_FRAMES * 3);

        // For video bg: frames 0-449 play the clip; frames 450-599 freeze last frame
        const bgImage = await getBgImage(bgSrc, Math.min(f, BG_CLIP_FREEZE_FRAME - 1));

        const poseSrc = pickPose(mood, f, isLastScene, poses);
        if (poseSrc !== lastPoseSrc) {
          lastPoseSrc = poseSrc;
          poseStartFrame = si * FRAMES_PER_SCENE + f;
        }
        const poseLocalFrame = (si * FRAMES_PER_SCENE + f) - poseStartFrame;
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
        const globalFrame = si * FRAMES_PER_SCENE + f;
        if (typeof global.gc === 'function' && globalFrame % 60 === 0) {
          global.gc();
        }
      }

      // ── Title card between scenes ─────────────────────────────────────────
      if (!isLastScene) {
        const nextScene = story.scenes[si + 1];
        // Use the last bg frame for the title card black overlay
        const bgImage = await getBgImage(bgSrc, BG_CLIP_FREEZE_FRAME - 1);
        for (let f = 0; f < TITLE_CARD_FRAMES; f++) {
          drawTitleCard(ctx, nextScene, f);
          await writeFrame();
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

  // ── Merge narration audio if provided ────────────────────────────────────
  let finalPath = outPath;
  if (audioPath) {
    finalPath = outPath.replace(/\.mp4$/, '-narrated.mp4');
    console.log('[renderer] Merging narration audio…');
    await mergeAudio(outPath, audioPath, finalPath);
    await fs.unlink(outPath).catch(() => {});
    console.log('[renderer] Audio merged → ' + finalPath);
  }

  try {
    await fs.mkdir(PUBLIC_VIDEOS_DIR, { recursive: true });
    await fs.copyFile(finalPath, path.join(PUBLIC_VIDEOS_DIR, path.basename(finalPath)));
  } catch { /* non-fatal */ }

  return finalPath;
}
