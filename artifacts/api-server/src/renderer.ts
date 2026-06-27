import { createCanvas, loadImage } from '@napi-rs/canvas';
import type { Image, SKRSContext2D } from '@napi-rs/canvas';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __rendererFilename = fileURLToPath(import.meta.url);
const __rendererDirname = path.dirname(__rendererFilename);

const W = 540;
const H = 960;
const OUT_W = 1080;
const OUT_H = 1920;
const FPS = 30;
const FRAMES_PER_SCENE = 20 * FPS; // 600 frames = 20 s
const FADE_FRAMES = 30;            // 1-second fade each side

const VIDEOS_DIR = '/tmp/dreamstick-videos';
const PUBLIC_VIDEOS_DIR = path.join(__rendererDirname, '..', '..', 'dreamstick', 'public', 'videos');
const BACKGROUNDS_DIR = path.join(__rendererDirname, '..', '..', 'dreamstick', 'public', 'backgrounds');
const CHARACTERS_DIR  = path.join(__rendererDirname, '..', '..', 'dreamstick', 'public', 'characters');

// Character layout (internal 540×960; everything × 2 in final 1080×1920)
const CHAR_H  = 450;                         // → 900 px final
const CHAR_W  = Math.round(CHAR_H * 0.558); // → ≈ 251 px internal
const CHAR_BOTTOM  = 762;
const CHAR_TOP_BASE = CHAR_BOTTOM - CHAR_H; // ≈ 312 — neutral top-Y of pose image
const CHAR_BASE_CX  = W / 2;
const CHAR_BASE_CY  = CHAR_TOP_BASE + CHAR_H / 2;

// Narration box
const BOX_Y = 772;
const BOX_H = 170;
const BOX_X = 18;
const BOX_W = W - 36;

const NAME_FONT = 'bold 36px Arial, sans-serif';
const GOLD = '#f7e96b';

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

// ── Pose set ─────────────────────────────────────────────────────────────────

interface PoseSet {
  run: Image; curious: Image; heroic: Image;
  triumph: Image; peaceful: Image; yawning: Image; asleep: Image;
}

async function loadPoseSet(gender: 'boy' | 'girl'): Promise<PoseSet> {
  const dir = path.join(CHARACTERS_DIR, gender);
  const load = (n: string) => loadImage(path.join(dir, `${n}.png`));
  const [run, curious, heroic, triumph, peaceful, yawning, asleep] = await Promise.all([
    load('run'), load('curious'), load('heroic'), load('triumph'),
    load('peaceful'), load('yawning'), load('asleep'),
  ]);
  return { run, curious, heroic, triumph, peaceful, yawning, asleep };
}

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

// ── Per-mood animation state ──────────────────────────────────────────────────

interface AnimState {
  charDX:     number;  // horizontal offset from neutral centre (px)
  charDY:     number;  // vertical offset (positive = down)
  charScaleX: number;  // horizontal scale
  charScaleY: number;  // vertical scale
  charRotDeg: number;  // rotation in degrees
  bgDX:       number;  // background parallax offset X
  bgDY:       number;  // background parallax offset Y
}

function getMoodAnim(mood: Mood, f: number, totalF: number): AnimState {
  const t = f / FPS;
  const p = f / totalF; // 0 → 1

  switch (mood) {

    case 'excited': {
      // Walk left → right; bouncy up on each step (abs-sin so always upward)
      const walkX = (p - 0.5) * 140;
      const step  = -Math.abs(Math.sin(t * Math.PI * 3.2)) * 10;
      return {
        charDX: walkX, charDY: step,
        charScaleX: 1, charScaleY: 1, charRotDeg: 0,
        bgDX: -walkX * 0.12, bgDY: -step * 0.08,
      };
    }

    case 'curious': {
      // Slow head-turn sway; very subtle zoom-in as if approaching something
      const sway  = Math.sin(t * 0.55) * 16;
      const lean  = -p * 8;                          // drifts slightly up/forward
      const scale = 1 + p * 0.04;                    // imperceptibly zooms in
      const tilt  = Math.sin(t * 0.45) * 2.5;
      return {
        charDX: sway, charDY: lean,
        charScaleX: scale, charScaleY: scale, charRotDeg: tilt,
        bgDX: -sway * 0.14, bgDY: -lean * 0.10,
      };
    }

    case 'brave': {
      // Chest-puff: subtle scale pulse. Stands dead-centre.
      const puff  = Math.sin(t * 1.5) * 0.025;
      const breathY = Math.sin(t * 0.9) * 3;
      return {
        charDX: 0, charDY: breathY,
        charScaleX: 1 + puff, charScaleY: 1 + puff, charRotDeg: 0,
        bgDX: 0, bgDY: -breathY * 0.06,
      };
    }

    case 'triumphant': {
      // Jump up/down (–40 px internal = –80 px final); rotation + lateral drift
      const jump   = -Math.abs(Math.sin(t * Math.PI * 2.4)) * 40;
      const rot    = Math.sin(t * Math.PI * 2.4) * 9;
      const driftX = Math.sin(t * 0.7) * 22;
      return {
        charDX: driftX, charDY: jump,
        charScaleX: 1, charScaleY: 1, charRotDeg: rot,
        bgDX: -driftX * 0.12, bgDY: -jump * 0.08,
      };
    }

    case 'peaceful': {
      // Very slow float and gentle sway
      const floatY = Math.sin(t * 0.48) * 8;
      const swayX  = Math.sin(t * 0.30) * 6;
      const tilt   = Math.sin(t * 0.27) * 1.5;
      return {
        charDX: swayX, charDY: floatY,
        charScaleX: 1, charScaleY: 1, charRotDeg: tilt,
        bgDX: -swayX * 0.10, bgDY: -floatY * 0.08,
      };
    }

    case 'sleepy': {
      // Sinks downward; all movement slows to near-zero by scene end
      const slowdown = 1 - p * 0.88;
      const sinkY    = p * 28;
      const drowsy   = Math.sin(t * 0.38 * slowdown) * 5 * slowdown;
      const swayX    = Math.sin(t * 0.26 * slowdown) * 4 * slowdown;
      const tilt     = Math.sin(t * 0.20 * slowdown) * 1.2 * slowdown;
      return {
        charDX: swayX, charDY: sinkY + drowsy,
        charScaleX: 1, charScaleY: 1, charRotDeg: tilt,
        bgDX: 0, bgDY: -sinkY * 0.07,
      };
    }
  }
}

// ── Golden particle system ────────────────────────────────────────────────────

interface Particle {
  spawnFrame: number;
  lifetime:   number;  // frames
  relX:       number;  // X offset relative to char centre
  speedY:     number;  // px / frame (negative = up)
  size:        number; // radius px
  driftX:     number;  // gentle horizontal drift px / frame
}

// Simple 32-bit LCG seeded by scene index so particles are deterministic
function makeRng(seed: number): () => number {
  let s = (seed * 6364136223846793005 + 1442695040888963407) | 0;
  return () => {
    s = Math.imul(1664525, s) + 1013904223;
    return (s >>> 0) / 0xffffffff;
  };
}

function createParticles(sceneIndex: number): Particle[] {
  const rng = makeRng(sceneIndex + 1);
  const particles: Particle[] = [];
  const spawnChance = 9 / 72; // ~9 visible at any time, avg 72-frame lifetime

  for (let f = 0; f < FRAMES_PER_SCENE; f++) {
    if (rng() < spawnChance) {
      particles.push({
        spawnFrame: f,
        lifetime:   Math.floor(rng() * 30) + 60,           // 60–90 frames
        relX:       (rng() - 0.5) * CHAR_W * 1.6,          // spread across char width
        speedY:     -(rng() * 1.4 + 0.5),                  // 0.5–1.9 px / frame up
        size:        rng() * 2.2 + 0.8,                     // 0.8–3.0 px radius
        driftX:      (rng() - 0.5) * 0.4,                  // slight left/right drift
      });
    }
  }
  return particles;
}

function drawParticles(
  ctx: SKRSContext2D,
  particles: Particle[],
  f: number,
  charCX: number,
  charCY: number,
): void {
  ctx.save();
  for (const p of particles) {
    const age = f - p.spawnFrame;
    if (age < 0 || age >= p.lifetime) continue;
    const progress = age / p.lifetime;
    // Fade in over 20%, fade out over remaining 80%
    const alpha = progress < 0.2
      ? (progress / 0.2) * 0.85
      : ((1 - progress) / 0.8) * 0.85;
    const px = charCX + p.relX + p.driftX * age;
    const py = charCY + p.speedY * age;

    ctx.globalAlpha = alpha;
    ctx.fillStyle   = GOLD;
    ctx.shadowBlur  = 8;
    ctx.shadowColor = GOLD;
    ctx.beginPath();
    ctx.arc(px, py, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ── Text helper ───────────────────────────────────────────────────────────────

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
  anim: AnimState,
  particles: Particle[],
  f: number,
  fadeAlpha: number,
): void {
  // Actual character centre this frame
  const charCX = CHAR_BASE_CX + anim.charDX;
  const charCY = CHAR_BASE_CY + anim.charDY;

  // ── Background with parallax (scale 6% larger so offsets never expose edges) ──
  const bgScale = Math.max(W / bg.width, H / bg.height) * 1.06;
  const bw = bg.width  * bgScale;
  const bh = bg.height * bgScale;
  ctx.drawImage(bg,
    (W - bw) / 2 + anim.bgDX,
    (H - bh) / 2 + anim.bgDY,
    bw, bh,
  );

  // ── Vignette ──
  const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.28, W / 2, H / 2, H * 0.82);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,10,0.55)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);

  // ── Golden glow behind character ──
  const glowHex = (char.glow_color ?? GOLD).replace('#', '');
  const gr = parseInt(glowHex.slice(0, 2), 16);
  const gg = parseInt(glowHex.slice(2, 4), 16);
  const gb = parseInt(glowHex.slice(4, 6), 16);
  const glow = ctx.createRadialGradient(charCX, charCY, 10, charCX, charCY, 210);
  glow.addColorStop(0, `rgba(${gr},${gg},${gb},0.28)`);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // ── Golden particles (behind character) ──
  drawParticles(ctx, particles, f, charCX, charCY);

  // ── Character pose — translated, scaled, rotated, screen-blended ──
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.translate(charCX, charCY);
  if (anim.charRotDeg !== 0) ctx.rotate(anim.charRotDeg * Math.PI / 180);
  if (anim.charScaleX !== 1 || anim.charScaleY !== 1)
    ctx.scale(anim.charScaleX, anim.charScaleY);
  ctx.drawImage(pose, -CHAR_W / 2, -CHAR_H / 2, CHAR_W, CHAR_H);
  ctx.restore();

  // ── Sidekick emoji (floats beside character) ──
  const sk = (char.sidekick ?? '').toLowerCase();
  if (sk && sk !== 'none') {
    const emoji = SIDEKICK_MAP[sk] ?? '✨';
    const t = f / FPS;
    const skX = charCX + CHAR_W / 2 + 22 + Math.sin(t * 1.4) * 5;
    const skY = charCY - CHAR_H * 0.18   + Math.sin(t * 1.8) * 7;
    ctx.save();
    ctx.font = '34px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, skX, skY);
    ctx.restore();
  }

  // ── Child's name — large gold text at top ──
  ctx.save();
  ctx.font = NAME_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor   = 'rgba(0,0,0,0.88)';
  ctx.shadowBlur    = 14;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = GOLD;
  ctx.fillText(char.child_name, W / 2, 52);
  ctx.restore();

  // ── Narration box ──
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,12,0.72)';
  ctx.beginPath();
  ctx.roundRect(BOX_X, BOX_Y, BOX_W, BOX_H, 14);
  ctx.fill();
  ctx.strokeStyle = 'rgba(247,233,107,0.30)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.font = '18px Arial, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.96)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.shadowBlur = 4;
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowOffsetY = 1;
  const lines   = wrapText(ctx, scene.narration, BOX_W - 28);
  const lineH   = 24;
  const totalTH = lines.length * lineH;
  const textY   = BOX_Y + (BOX_H - 20 - totalTH) / 2;
  lines.forEach((line, i) => ctx.fillText(line, W / 2, textY + i * lineH));
  ctx.restore();

  // ── Watermark ──
  ctx.save();
  ctx.font = '10px Arial, sans-serif';
  ctx.fillStyle = 'rgba(247,233,107,0.45)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('✦ DreamStick Adventures', W / 2, BOX_Y + BOX_H - 5);
  ctx.restore();

  // ── Scene indicator ──
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
    try { return await loadImage(path.join(dir, `bg${n}.png`)); } catch { /* next */ }
  }
  throw new Error(`No backgrounds for theme "${theme}" in ${dir}`);
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function renderVideo(char: RenderCharacter, story: RenderStory): Promise<string> {
  await fs.mkdir(VIDEOS_DIR, { recursive: true });

  const safeName = char.child_name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const ts       = Date.now();
  const outPath  = path.join(VIDEOS_DIR, `${safeName}-${ts}.mp4`);
  const theme    = (char.theme ?? 'space').toLowerCase();
  const gender: 'boy' | 'girl' = (char.gender ?? char.character_type) === 'girl' ? 'girl' : 'boy';

  const [poses, bgs] = await Promise.all([
    loadPoseSet(gender),
    (async () => {
      const used = new Set<number>();
      const imgs: Image[] = [];
      for (let i = 0; i < story.scenes.length; i++)
        imgs.push(await loadBg(theme, used));
      return imgs;
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
      code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}: ${ffErrors.join('').slice(-800)}`))
    );
    ff.on('error', reject);
  });

  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext('2d');
  const totalScenes = story.scenes.length;

  try {
    for (let si = 0; si < totalScenes; si++) {
      const scene       = story.scenes[si];
      const bg          = bgs[si];
      const isLastScene = si === totalScenes - 1;
      const mood        = scene.mood as Mood;
      const pose        = pickPose(mood, isLastScene, poses);
      const particles   = createParticles(si); // deterministic per scene

      for (let f = 0; f < FRAMES_PER_SCENE; f++) {
        // Fade in/out logic
        let fadeAlpha = 0;
        if (si > 0 && f < FADE_FRAMES)
          fadeAlpha = 1 - f / FADE_FRAMES;
        if (si < totalScenes - 1 && f >= FRAMES_PER_SCENE - FADE_FRAMES)
          fadeAlpha = (f - (FRAMES_PER_SCENE - FADE_FRAMES)) / FADE_FRAMES;
        if (isLastScene && f >= FRAMES_PER_SCENE - FADE_FRAMES * 3)
          fadeAlpha = (f - (FRAMES_PER_SCENE - FADE_FRAMES * 3)) / (FADE_FRAMES * 3);

        const anim = getMoodAnim(mood, f, FRAMES_PER_SCENE);

        drawFrame(ctx, bg, char, scene, pose, anim, particles, f,
                  Math.min(1, Math.max(0, fadeAlpha)));

        const raw = Buffer.from(ctx.getImageData(0, 0, W, H).data.buffer);
        const ok  = ff.stdin.write(raw);
        if (!ok) await new Promise<void>(r => ff.stdin.once('drain', r));
      }
    }
  } finally {
    ff.stdin.end();
  }

  await done;

  try {
    await fs.mkdir(PUBLIC_VIDEOS_DIR, { recursive: true });
    await fs.copyFile(outPath, path.join(PUBLIC_VIDEOS_DIR, path.basename(outPath)));
  } catch { /* non-fatal */ }

  return outPath;
}
