import { createCanvas, loadImage } from '@napi-rs/canvas';
import type { Image, SKRSContext2D } from '@napi-rs/canvas';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __rendererFilename = fileURLToPath(import.meta.url);
const __rendererDirname = path.dirname(__rendererFilename);

// Internal render resolution (540x960) → upscaled to 1080x1920 by ffmpeg
const W = 540;
const H = 960;
const OUT_W = 1080;
const OUT_H = 1920;
const FPS = 30;
const FRAMES_PER_SCENE = 20 * FPS; // 600
const FADE_FRAMES = 15;

const VIDEOS_DIR = '/tmp/dreamstick-videos';
const PUBLIC_VIDEOS_DIR = path.join(__rendererDirname, '..', '..', 'dreamstick', 'public', 'videos');
const BACKGROUNDS_DIR = path.join(__rendererDirname, '..', '..', 'dreamstick', 'public', 'backgrounds');
const POSES_DIR = path.join(__rendererDirname, '..', '..', 'dreamstick', 'public', 'poses');

// All pose images share the same 0.558 aspect ratio
// Rendered at POSE_W wide → POSE_H tall, bottom-aligned above narration box
const POSE_W = 400;
const POSE_H = Math.round(POSE_W / 0.558); // ≈ 717
const POSE_X = (W - POSE_W) / 2; // 70 — centered
const NARRATION_TOP = H - 189;
const POSE_BOTTOM = NARRATION_TOP - 12;
const POSE_TOP_BASE = POSE_BOTTOM - POSE_H; // ≈ 22

const GOLD = '#FFD700';

const SIDEKICK_MAP: Record<string, string> = {
  dragon: '🐉', cat: '🐱', dog: '🐶', rabbit: '🐰',
  robot: '🤖', unicorn: '🦄', owl: '🦉', fox: '🦊',
  parrot: '🦜', turtle: '🐢',
};

export type Mood = 'excited' | 'curious' | 'brave' | 'triumphant' | 'peaceful' | 'sleepy';

export interface RenderCharacter {
  child_name: string;
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

// ── Pose images ───────────────────────────────────────────────────────────────

interface PoseImages {
  asleep: Image;
  curious: Image;
  heroic: Image;
  peaceful: Image;
  pointing: Image;
  run: Image;
  sneak: Image;
  triumph: Image;
  walk: Image;
  wave: Image;
  wonder: Image;
  yawning: Image;
}

async function loadPoses(): Promise<PoseImages> {
  const load = (name: string) => loadImage(path.join(POSES_DIR, `boy-${name}.png`));
  const [asleep, curious, heroic, peaceful, pointing, run, sneak, triumph, walk, wave, wonder, yawning] =
    await Promise.all([
      load('asleep'), load('curious'), load('heroic'), load('peaceful'),
      load('pointing'), load('run'), load('sneak'), load('triumph'),
      load('walk'), load('wave'), load('wonder'), load('yawning'),
    ]);
  return { asleep, curious, heroic, peaceful, pointing, run, sneak, triumph, walk, wave, wonder, yawning };
}

// Map each mood to two poses — crossfade at scene midpoint
function moodPoses(mood: Mood, p: PoseImages): [Image, Image | null] {
  switch (mood) {
    case 'excited':    return [p.run, p.wave];
    case 'curious':    return [p.wonder, p.curious];
    case 'brave':      return [p.sneak, p.pointing];
    case 'triumphant': return [p.triumph, null];
    case 'peaceful':   return [p.walk, p.peaceful];
    case 'sleepy':     return [p.yawning, p.asleep];
  }
}

// ── Drawing helpers ───────────────────────────────────────────────────────────

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

// Draw a character pose image using screen blend mode so black bg disappears
function drawPose(ctx: SKRSContext2D, img: Image, alpha: number, bobY: number): void {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, Math.max(0, alpha));
  ctx.globalCompositeOperation = 'screen';
  ctx.drawImage(img, POSE_X, POSE_TOP_BASE + bobY, POSE_W, POSE_H);
  ctx.restore();
}

// ── Frame renderer ────────────────────────────────────────────────────────────

function drawFrame(
  ctx: SKRSContext2D,
  bg: Image,
  char: RenderCharacter,
  scene: RenderScene,
  poses: PoseImages,
  frameInScene: number,
  fadeAlpha: number,
): void {
  const t = frameInScene / FPS;
  const mood = scene.mood as Mood;

  // ── Background ──
  ctx.drawImage(bg, 0, 0, W, H);

  // ── Vignette ──
  const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.28, W / 2, H / 2, H * 0.82);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,15,0.5)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);

  // ── Character bob animation ──
  const bobAmt = mood === 'triumphant' ? 14 : mood === 'excited' ? 9 : mood === 'sleepy' ? 2 : 5;
  const bobSpeed = mood === 'triumphant' ? 2.8 : mood === 'excited' ? 3.5 : mood === 'sleepy' ? 0.4 : 1.2;
  const bobY = Math.sin(t * Math.PI * bobSpeed) * bobAmt;

  // ── Pose crossfade ──
  const [img1, img2] = moodPoses(mood, poses);
  const CROSSFADE_START = FRAMES_PER_SCENE / 2; // 10 s
  const CROSSFADE_DUR = 60; // 2 s
  let blend = 0;
  if (img2 && frameInScene >= CROSSFADE_START) {
    blend = Math.min(1, (frameInScene - CROSSFADE_START) / CROSSFADE_DUR);
  }

  // Subtle golden glow behind character
  const glowCol = (char.glow_color ?? GOLD).replace('#', '');
  const gr = parseInt(glowCol.slice(0, 2), 16);
  const gg = parseInt(glowCol.slice(2, 4), 16);
  const gb = parseInt(glowCol.slice(4, 6), 16);
  const charCY = POSE_TOP_BASE + POSE_H * 0.5 + bobY;
  const glow = ctx.createRadialGradient(W / 2, charCY, 20, W / 2, charCY, 220);
  glow.addColorStop(0, `rgba(${gr},${gg},${gb},0.18)`);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // ── Draw pose(s) ──
  if (img2 && blend > 0) {
    drawPose(ctx, img1, 1 - blend, bobY);
    drawPose(ctx, img2, blend, bobY);
  } else {
    drawPose(ctx, img1, 1, bobY);
  }

  // ── Child name label (above character head, ~13% from image top) ──
  const nameY = POSE_TOP_BASE + POSE_H * 0.11 + bobY;
  ctx.save();
  ctx.font = 'bold 30px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Subtle backing pill
  const nameMeasure = ctx.measureText(char.child_name);
  const nw = nameMeasure.width + 28;
  const nh = 36;
  ctx.fillStyle = 'rgba(0,0,12,0.55)';
  ctx.beginPath();
  ctx.roundRect(W / 2 - nw / 2, nameY - nh / 2, nw, nh, 18);
  ctx.fill();
  ctx.shadowBlur = 14;
  ctx.shadowColor = GOLD;
  ctx.fillStyle = GOLD;
  ctx.fillText(char.child_name, W / 2, nameY);
  ctx.restore();

  // ── Sidekick emoji ──
  const sk = (char.sidekick ?? '').toLowerCase();
  if (sk && sk !== 'none') {
    const emoji = SIDEKICK_MAP[sk] ?? '✨';
    const skX = POSE_X + POSE_W + 18 + Math.sin(t * Math.PI * 1.1) * 6;
    const skY = POSE_TOP_BASE + POSE_H * 0.28 + bobY + Math.sin(t * Math.PI * 1.4) * 8;
    ctx.save();
    ctx.font = '42px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, skX, skY);
    ctx.restore();
  }

  // ── Narration box ──
  const boxX = 18;
  const boxY = NARRATION_TOP;
  const boxW = W - 36;
  const boxH = 172;
  const pad = 16;
  const r = 14;

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,14,0.70)';
  ctx.beginPath();
  ctx.roundRect(boxX, boxY, boxW, boxH, r);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,215,0,0.40)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.font = '20px Arial, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.shadowBlur = 3;
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  const lines = wrapText(ctx, scene.narration, boxW - pad * 2);
  const lineH = 26;
  const totalH = lines.length * lineH;
  const ty = boxY + (boxH - totalH) / 2;
  lines.forEach((line, i) => ctx.fillText(line, W / 2, ty + i * lineH));
  ctx.restore();

  // ── Scene title (small, top-right corner) ──
  ctx.save();
  ctx.font = '13px Arial, sans-serif';
  ctx.fillStyle = 'rgba(255,215,0,0.5)';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText(`Scene ${scene.scene_number} of 6`, W - 14, 14);
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

  // Load poses and backgrounds in parallel
  const [poses, bgs] = await Promise.all([
    loadPoses(),
    (async () => {
      const used = new Set<number>();
      const result: Image[] = [];
      for (let i = 0; i < story.scenes.length; i++) {
        result.push(await loadBg(theme, used));
      }
      return result;
    })(),
  ]);

  // Spawn ffmpeg: raw RGBA stdin → H.264 1080x1920 MP4
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

  try {
    for (let si = 0; si < story.scenes.length; si++) {
      const scene = story.scenes[si];
      const bg = bgs[si];

      for (let f = 0; f < FRAMES_PER_SCENE; f++) {
        let fadeAlpha = 0;
        if (si > 0 && f < FADE_FRAMES) {
          fadeAlpha = 1 - f / FADE_FRAMES;
        }
        if (si < story.scenes.length - 1 && f >= FRAMES_PER_SCENE - FADE_FRAMES) {
          fadeAlpha = (f - (FRAMES_PER_SCENE - FADE_FRAMES)) / FADE_FRAMES;
        }
        if (si === story.scenes.length - 1 && f >= FRAMES_PER_SCENE - FADE_FRAMES * 3) {
          fadeAlpha = (f - (FRAMES_PER_SCENE - FADE_FRAMES * 3)) / (FADE_FRAMES * 3);
        }

        drawFrame(ctx, bg, char, scene, poses, f, Math.min(1, Math.max(0, fadeAlpha)));

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
