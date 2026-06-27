import { createCanvas, loadImage } from '@napi-rs/canvas';
import type { Image, SKRSContext2D } from '@napi-rs/canvas';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __rendererFilename = fileURLToPath(import.meta.url);
const __rendererDirname = path.dirname(__rendererFilename);

// Internal render resolution — upscaled 2× to 1080×1920 by ffmpeg
const W = 540;
const H = 960;
const OUT_W = 1080;
const OUT_H = 1920;
const FPS = 30;
const FRAMES_PER_SCENE = 20 * FPS; // 600 frames = 20 seconds per scene
const FADE_FRAMES = 30;             // 1-second fade out + 1-second fade in

const VIDEOS_DIR = '/tmp/dreamstick-videos';
const PUBLIC_VIDEOS_DIR = path.join(__rendererDirname, '..', '..', 'dreamstick', 'public', 'videos');
const BACKGROUNDS_DIR = path.join(__rendererDirname, '..', '..', 'dreamstick', 'public', 'backgrounds');
const CHARACTERS_DIR = path.join(__rendererDirname, '..', '..', 'dreamstick', 'public', 'characters');

// ── Layout (internal 540×960 px, everything doubles in the final 1080×1920 output) ──
// All pose images share the same 0.558 aspect ratio (373×669 or 1536×2752)
const CHAR_H = 300;                          // 600 px in final output
const CHAR_W = Math.round(CHAR_H * 0.558);  // ≈ 167 px internal
const CHAR_BOTTOM = 762;                     // just above narration box
const CHAR_TOP = CHAR_BOTTOM - CHAR_H;      // ≈ 462
const CHAR_X = (W - CHAR_W) / 2;           // centered
const CHAR_CX = W / 2;
const CHAR_CY = CHAR_TOP + CHAR_H / 2;     // vertical center of character

// Name label sits near the top of the canvas
const NAME_Y = 52;
const NAME_FONT = 'bold 36px Arial, sans-serif'; // → 72px in final
const GOLD = '#f7e96b';

// Narration box
const BOX_Y = 772;
const BOX_H = 170;
const BOX_X = 18;
const BOX_W = W - 36;

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

// ── Pose set (7 poses needed: one per mood + asleep for last scene) ──────────

interface PoseSet {
  run: Image;
  curious: Image;
  heroic: Image;
  triumph: Image;
  peaceful: Image;
  yawning: Image;
  asleep: Image;
}

async function loadPoseSet(gender: 'boy' | 'girl'): Promise<PoseSet> {
  const dir = path.join(CHARACTERS_DIR, gender);
  const load = (name: string) => loadImage(path.join(dir, `${name}.png`));
  const [run, curious, heroic, triumph, peaceful, yawning, asleep] = await Promise.all([
    load('run'), load('curious'), load('heroic'), load('triumph'),
    load('peaceful'), load('yawning'), load('asleep'),
  ]);
  return { run, curious, heroic, triumph, peaceful, yawning, asleep };
}

// Map mood → pose. Last scene always uses asleep.
function pickPose(mood: Mood, isLastScene: boolean, poses: PoseSet): Image {
  if (isLastScene) return poses.asleep;
  switch (mood) {
    case 'excited':    return poses.run;
    case 'curious':    return poses.curious;
    case 'brave':      return poses.heroic;
    case 'triumphant': return poses.triumph;
    case 'peaceful':   return poses.peaceful;
    case 'sleepy':     return poses.yawning;
  }
}

// ── Text helpers ─────────────────────────────────────────────────────────────

function wrapText(ctx: SKRSContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// ── Frame renderer ────────────────────────────────────────────────────────────

function drawFrame(
  ctx: SKRSContext2D,
  bg: Image,
  char: RenderCharacter,
  scene: RenderScene,
  pose: Image,
  bobY: number,
  fadeAlpha: number,
): void {
  // ── Background — scale and crop to fill 540×960 ──
  const bgScale = Math.max(W / bg.width, H / bg.height);
  const bw = bg.width * bgScale;
  const bh = bg.height * bgScale;
  ctx.drawImage(bg, (W - bw) / 2, (H - bh) / 2, bw, bh);

  // ── Vignette (darken edges) ──
  const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.28, W / 2, H / 2, H * 0.82);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,10,0.55)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);

  // ── Soft radial golden glow behind character ──
  const glowHex = (char.glow_color ?? GOLD).replace('#', '');
  const gr = parseInt(glowHex.slice(0, 2), 16);
  const gg = parseInt(glowHex.slice(2, 4), 16);
  const gb = parseInt(glowHex.slice(4, 6), 16);
  const charCY = CHAR_CY + bobY;
  const glow = ctx.createRadialGradient(CHAR_CX, charCY, 10, CHAR_CX, charCY, 210);
  glow.addColorStop(0, `rgba(${gr},${gg},${gb},0.26)`);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // ── Character pose (screen blend — black bg disappears, golden glow composites) ──
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.drawImage(pose, CHAR_X, CHAR_TOP + bobY, CHAR_W, CHAR_H);
  ctx.restore();

  // ── Sidekick emoji (floats beside character) ──
  const sk = (char.sidekick ?? '').toLowerCase();
  if (sk && sk !== 'none') {
    const emoji = SIDEKICK_MAP[sk] ?? '✨';
    const t = Date.now() / 1000; // wall-clock for smooth float (fine for non-deterministic)
    const skX = CHAR_X + CHAR_W + 22 + Math.sin(t * 1.3) * 5;
    const skY = CHAR_TOP + CHAR_H * 0.3 + bobY + Math.sin(t * 1.7) * 7;
    ctx.save();
    ctx.font = '34px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, skX, skY);
    ctx.restore();
  }

  // ── Child's name — large gold text at top of screen ──
  ctx.save();
  ctx.font = NAME_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Dark shadow for readability
  ctx.shadowColor = 'rgba(0,0,0,0.85)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = GOLD;
  ctx.fillText(char.child_name, W / 2, NAME_Y);
  ctx.restore();

  // ── Narration box — semi-transparent dark rounded rect at bottom ──
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,12,0.72)';
  ctx.beginPath();
  ctx.roundRect(BOX_X, BOX_Y, BOX_W, BOX_H, 14);
  ctx.fill();
  ctx.strokeStyle = 'rgba(247,233,107,0.30)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Narration text
  ctx.font = '18px Arial, sans-serif'; // → 36px in final
  ctx.fillStyle = 'rgba(255,255,255,0.96)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.shadowBlur = 4;
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowOffsetY = 1;
  const lines = wrapText(ctx, scene.narration, BOX_W - 28);
  const lineH = 24;
  const totalTextH = lines.length * lineH;
  const textStartY = BOX_Y + (BOX_H - 20 - totalTextH) / 2; // leave 20px at bottom for watermark
  lines.forEach((line, i) => ctx.fillText(line, W / 2, textStartY + i * lineH));
  ctx.restore();

  // ── DreamStick Adventures watermark ──
  ctx.save();
  ctx.font = '10px Arial, sans-serif'; // → 20px in final
  ctx.fillStyle = 'rgba(247,233,107,0.45)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('✦ DreamStick Adventures', W / 2, BOX_Y + BOX_H - 5);
  ctx.restore();

  // ── Scene indicator (top-right, subtle) ──
  ctx.save();
  ctx.font = '10px Arial, sans-serif';
  ctx.fillStyle = 'rgba(255,215,0,0.35)';
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

// ── Background loader ─────────────────────────────────────────────────────────

async function loadBg(theme: string, used: Set<number>): Promise<Image> {
  const dir = path.join(BACKGROUNDS_DIR, theme.toLowerCase());
  const available = [1, 2, 3].filter(n => !used.has(n));
  const pick = available.length > 0
    ? available[Math.floor(Math.random() * available.length)]
    : Math.floor(Math.random() * 3) + 1;
  used.add(pick);

  for (const n of [pick, 1, 2, 3]) {
    try { return await loadImage(path.join(dir, `bg${n}.png`)); } catch { /* try next */ }
  }
  throw new Error(`No backgrounds found for theme "${theme}" in ${dir}`);
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function renderVideo(char: RenderCharacter, story: RenderStory): Promise<string> {
  await fs.mkdir(VIDEOS_DIR, { recursive: true });

  const safeName = char.child_name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const ts = Date.now();
  const outPath = path.join(VIDEOS_DIR, `${safeName}-${ts}.mp4`);
  const theme = (char.theme ?? 'space').toLowerCase();
  const gender: 'boy' | 'girl' = (char.gender ?? char.character_type) === 'girl' ? 'girl' : 'boy';

  // Load poses and backgrounds in parallel
  const [poses, bgs] = await Promise.all([
    loadPoseSet(gender),
    (async () => {
      const used = new Set<number>();
      const imgs: Image[] = [];
      for (let i = 0; i < story.scenes.length; i++) {
        imgs.push(await loadBg(theme, used));
      }
      return imgs;
    })(),
  ]);

  // Spawn ffmpeg: raw RGBA stdin → H.264 1080×1920 MP4
  const ff = spawn('ffmpeg', [
    '-y',
    '-f', 'rawvideo',
    '-pixel_format', 'rgba',
    '-video_size', `${W}x${H}`,
    '-framerate', String(FPS),
    '-i', 'pipe:0',
    '-vf', `scale=${OUT_W}:${OUT_H}:flags=lanczos`,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-crf', '22',
    '-preset', 'veryfast',
    '-movflags', '+faststart',
    outPath,
  ]);

  const ffErrors: string[] = [];
  ff.stderr.on('data', (d: Buffer) => ffErrors.push(d.toString()));

  const done = new Promise<void>((resolve, reject) => {
    ff.on('close', (code: number) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exit ${code}: ${ffErrors.join('').slice(-800)}`));
    });
    ff.on('error', reject);
  });

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const totalScenes = story.scenes.length;

  try {
    for (let si = 0; si < totalScenes; si++) {
      const scene = story.scenes[si];
      const bg = bgs[si];
      const isLastScene = si === totalScenes - 1;
      const mood = scene.mood as Mood;
      const pose = pickPose(mood, isLastScene, poses);

      // Bob parameters per mood
      const bobAmt = mood === 'triumphant' ? 12 : mood === 'excited' ? 8 : mood === 'sleepy' ? 2 : 5;
      const bobSpd = mood === 'triumphant' ? 3.0 : mood === 'excited' ? 3.5 : mood === 'sleepy' ? 0.4 : 1.2;

      for (let f = 0; f < FRAMES_PER_SCENE; f++) {
        const t = f / FPS;

        // 1-second (30-frame) fade out at end of each scene (except last, which fades longer)
        // 1-second (30-frame) fade in at start of each scene (except first)
        let fadeAlpha = 0;
        if (si > 0 && f < FADE_FRAMES) {
          fadeAlpha = 1 - f / FADE_FRAMES;
        }
        if (si < totalScenes - 1 && f >= FRAMES_PER_SCENE - FADE_FRAMES) {
          fadeAlpha = (f - (FRAMES_PER_SCENE - FADE_FRAMES)) / FADE_FRAMES;
        }
        // Final scene fades to black over 3 seconds
        if (isLastScene && f >= FRAMES_PER_SCENE - FADE_FRAMES * 3) {
          fadeAlpha = (f - (FRAMES_PER_SCENE - FADE_FRAMES * 3)) / (FADE_FRAMES * 3);
        }

        const bobY = Math.sin(t * Math.PI * bobSpd) * bobAmt;

        drawFrame(ctx, bg, char, scene, pose, bobY, Math.min(1, Math.max(0, fadeAlpha)));

        const raw = Buffer.from(ctx.getImageData(0, 0, W, H).data.buffer);
        const ok = ff.stdin.write(raw);
        if (!ok) await new Promise<void>(r => ff.stdin.once('drain', r));
      }
    }
  } finally {
    ff.stdin.end();
  }

  await done;

  // Copy to frontend public/videos for static serving
  try {
    await fs.mkdir(PUBLIC_VIDEOS_DIR, { recursive: true });
    await fs.copyFile(outPath, path.join(PUBLIC_VIDEOS_DIR, path.basename(outPath)));
  } catch { /* non-fatal */ }

  return outPath;
}
