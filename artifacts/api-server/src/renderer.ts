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
const BACKGROUNDS_DIR = path.join(__rendererDirname, '..', '..', 'dreamstick', 'public', 'backgrounds');

// Character geometry (scaled for 540x960)
const HEAD_R = 39;
const NECK_H = 11;
const TORSO_H = 89;
const SHOULDER_W = 41;
const HIP_W = 29;
const ARM_LEN = 59;
const THIGH_LEN = 54;
const SHIN_LEN = 46;
const LINE_W = 6.5;
const FEET_Y = H - 215;

const SKIN = '#FDBCB4';
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

// ── Pose ─────────────────────────────────────────────────────────────────────

interface Pose {
  bounceY: number;
  leftArmAngle: number;
  rightArmAngle: number;
  bodyTilt: number;
}

function getPose(mood: Mood, t: number): Pose {
  switch (mood) {
    case 'excited':
      return {
        bounceY: Math.sin(t * Math.PI * 4) * 8,
        leftArmAngle: Math.PI * 0.68 + Math.sin(t * Math.PI * 3) * 0.14,
        rightArmAngle: Math.PI * 0.68 + Math.sin(t * Math.PI * 3 + 1.2) * 0.14,
        bodyTilt: Math.sin(t * Math.PI * 2) * 0.04,
      };
    case 'curious':
      return {
        bounceY: Math.sin(t * Math.PI) * 3,
        leftArmAngle: Math.PI * 0.35,
        rightArmAngle: Math.PI * 0.58 + Math.sin(t * Math.PI * 1.5) * 0.07,
        bodyTilt: 0.08,
      };
    case 'brave':
      return {
        bounceY: Math.sin(t * Math.PI * 2) * 4,
        leftArmAngle: Math.PI * 0.52,
        rightArmAngle: Math.PI * 0.52,
        bodyTilt: 0,
      };
    case 'triumphant':
      return {
        bounceY: Math.sin(t * Math.PI * 2.5) * 7,
        leftArmAngle: Math.PI * 0.88,
        rightArmAngle: Math.PI * 0.88,
        bodyTilt: 0,
      };
    case 'peaceful':
      return {
        bounceY: Math.sin(t * Math.PI * 0.8) * 2,
        leftArmAngle: Math.PI * 0.26 + Math.sin(t * Math.PI * 0.6) * 0.04,
        rightArmAngle: Math.PI * 0.26 + Math.sin(t * Math.PI * 0.6) * 0.04,
        bodyTilt: Math.sin(t * Math.PI * 0.5) * 0.025,
      };
    case 'sleepy':
      return {
        bounceY: Math.sin(t * Math.PI * 0.5) * 1,
        leftArmAngle: Math.PI * 0.1,
        rightArmAngle: Math.PI * 0.1,
        bodyTilt: 0.16,
      };
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

function drawHair(ctx: SKRSContext2D, cx: number, cy: number, style: string, color: string): void {
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  switch (style.toLowerCase()) {
    case 'long':
      ctx.beginPath();
      ctx.ellipse(cx, cy - HEAD_R * 0.1, HEAD_R + 7, HEAD_R * 0.6, 0, Math.PI, 0);
      ctx.fill();
      ctx.lineWidth = 15;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx - HEAD_R, cy);
      ctx.quadraticCurveTo(cx - HEAD_R - 14, cy + 45, cx - HEAD_R - 9, cy + 85);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx + HEAD_R, cy);
      ctx.quadraticCurveTo(cx + HEAD_R + 14, cy + 45, cx + HEAD_R + 9, cy + 85);
      ctx.stroke();
      break;
    case 'curly':
      for (let i = 0; i < 6; i++) {
        const angle = Math.PI + (i / 5) * Math.PI;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(angle) * (HEAD_R - 4), cy + Math.sin(angle) * (HEAD_R - 4), 12, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'braids':
      ctx.beginPath();
      ctx.ellipse(cx, cy - HEAD_R * 0.12, HEAD_R + 4, HEAD_R * 0.58, 0, Math.PI, 0);
      ctx.fill();
      ctx.lineWidth = 9;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx - HEAD_R - 3, cy + 8);
      ctx.lineTo(cx - HEAD_R - 4, cy + 70);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx + HEAD_R + 3, cy + 8);
      ctx.lineTo(cx + HEAD_R + 4, cy + 70);
      ctx.stroke();
      break;
    default: // short
      ctx.beginPath();
      ctx.ellipse(cx, cy - HEAD_R * 0.15, HEAD_R + 3, HEAD_R * 0.6, 0, Math.PI, 0);
      ctx.fill();
      break;
  }
}

function drawFigureLines(
  ctx: SKRSContext2D,
  CX: number, headCY: number,
  shoulderY: number, hipY: number,
  lShX: number, rShX: number,
  lHipX: number, rHipX: number,
  pose: Pose, feetY: number,
): void {
  ctx.lineWidth = LINE_W;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Neck
  ctx.beginPath(); ctx.moveTo(CX, headCY + HEAD_R - 2); ctx.lineTo(CX, shoulderY); ctx.stroke();
  // Torso
  ctx.beginPath(); ctx.moveTo(CX, shoulderY); ctx.lineTo(CX, hipY); ctx.stroke();
  // Shoulder bar
  ctx.beginPath(); ctx.moveTo(lShX, shoulderY); ctx.lineTo(rShX, shoulderY); ctx.stroke();

  // Left arm
  const lArmX = lShX - Math.sin(pose.leftArmAngle) * ARM_LEN;
  const lArmY = shoulderY + Math.cos(pose.leftArmAngle) * ARM_LEN;
  ctx.beginPath(); ctx.moveTo(lShX, shoulderY); ctx.lineTo(lArmX, lArmY); ctx.stroke();

  // Right arm
  const rArmX = rShX + Math.sin(pose.rightArmAngle) * ARM_LEN;
  const rArmY = shoulderY + Math.cos(pose.rightArmAngle) * ARM_LEN;
  ctx.beginPath(); ctx.moveTo(rShX, shoulderY); ctx.lineTo(rArmX, rArmY); ctx.stroke();

  // Hip bar
  ctx.beginPath(); ctx.moveTo(lHipX, hipY); ctx.lineTo(rHipX, hipY); ctx.stroke();

  // Legs
  const lKneeX = lHipX - 6;
  const rKneeX = rHipX + 6;
  const kneeY = hipY + THIGH_LEN;
  ctx.beginPath(); ctx.moveTo(lHipX, hipY); ctx.lineTo(lKneeX, kneeY); ctx.lineTo(lKneeX + 4, feetY); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(rHipX, hipY); ctx.lineTo(rKneeX, kneeY); ctx.lineTo(rKneeX - 4, feetY); ctx.stroke();

  // Feet
  ctx.lineWidth = LINE_W * 0.65;
  ctx.beginPath(); ctx.moveTo(lKneeX + 4 - 11, feetY); ctx.lineTo(lKneeX + 4 + 13, feetY); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(rKneeX - 4 - 13, feetY); ctx.lineTo(rKneeX - 4 + 11, feetY); ctx.stroke();
}

function drawFrame(
  ctx: SKRSContext2D,
  bg: Image,
  char: RenderCharacter,
  scene: RenderScene,
  frameInScene: number,
  fadeAlpha: number,
): void {
  const t = frameInScene / FPS;
  const mood = scene.mood as Mood;
  const pose = getPose(mood, t);

  const CX = W / 2;
  const feetY = FEET_Y + pose.bounceY;
  const headCY = feetY - SHIN_LEN - THIGH_LEN - TORSO_H - NECK_H - HEAD_R;
  const shoulderY = headCY + HEAD_R + NECK_H;
  const hipY = shoulderY + TORSO_H;
  const lShX = CX - SHOULDER_W;
  const rShX = CX + SHOULDER_W;
  const lHipX = CX - HIP_W;
  const rHipX = CX + HIP_W;

  const outfitColor = char.outfit_color ?? '#9b59b6';
  const hairColor = char.hair_color ?? '#3a1e08';
  const hasCape = (char.accessories ?? '').toLowerCase().includes('cape');
  const hasHat = (char.accessories ?? '').toLowerCase().includes('hat');

  // Background
  ctx.drawImage(bg, 0, 0, W, H);

  // Vignette
  const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.28, W / 2, H / 2, H * 0.82);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,15,0.48)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);

  // Cape (behind character)
  if (hasCape) {
    ctx.save();
    ctx.translate(CX, shoulderY);
    ctx.rotate(pose.bodyTilt);
    ctx.translate(-CX, -shoulderY);
    const capeW = SHOULDER_W + 28;
    const capeH = TORSO_H + THIGH_LEN * 0.85;
    ctx.fillStyle = outfitColor;
    ctx.globalAlpha = 0.82;
    ctx.beginPath();
    ctx.moveTo(CX - capeW, shoulderY);
    ctx.quadraticCurveTo(CX - capeW - 11, shoulderY + capeH * 0.5, CX - 14, shoulderY + capeH);
    ctx.lineTo(CX + 14, shoulderY + capeH);
    ctx.quadraticCurveTo(CX + capeW + 11, shoulderY + capeH * 0.5, CX + capeW, shoulderY);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // Glow pass
  ctx.save();
  ctx.shadowBlur = 28;
  ctx.shadowColor = GOLD;
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = LINE_W + 3.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  drawFigureLines(ctx, CX, headCY, shoulderY, hipY, lShX, rShX, lHipX, rHipX, pose, feetY);
  ctx.beginPath();
  ctx.arc(CX, headCY, HEAD_R + 3, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,215,0,0.15)';
  ctx.fill();
  ctx.restore();

  // Body (outfit color)
  ctx.save();
  ctx.strokeStyle = outfitColor;
  drawFigureLines(ctx, CX, headCY, shoulderY, hipY, lShX, rShX, lHipX, rHipX, pose, feetY);
  ctx.restore();

  // Head
  ctx.save();
  ctx.shadowBlur = 20;
  ctx.shadowColor = GOLD;
  ctx.beginPath();
  ctx.arc(CX, headCY, HEAD_R, 0, Math.PI * 2);
  ctx.fillStyle = SKIN;
  ctx.fill();
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  // Hair
  drawHair(ctx, CX, headCY, char.hair_style ?? 'short', hairColor);

  // Face
  ctx.save();
  const eyeX = 13;
  const eyeY = headCY - 5;

  if (mood === 'sleepy') {
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath();
    ctx.ellipse(CX - eyeX, eyeY, 4.5, 2.5, 0, 0, Math.PI * 2);
    ctx.ellipse(CX + eyeX, eyeY, 4.5, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath();
    ctx.arc(CX - eyeX, eyeY, 4.5, 0, Math.PI * 2);
    ctx.arc(CX + eyeX, eyeY, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'white';
    ctx.beginPath();
    ctx.arc(CX - eyeX + 1.5, eyeY - 1.5, 1.8, 0, Math.PI * 2);
    ctx.arc(CX + eyeX + 1.5, eyeY - 1.5, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }

  // Eyebrows
  ctx.strokeStyle = hairColor;
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  if (mood === 'brave' || mood === 'triumphant') {
    ctx.beginPath();
    ctx.moveTo(CX - eyeX - 6, eyeY - 11); ctx.lineTo(CX - eyeX + 6, eyeY - 9); ctx.stroke();
    ctx.moveTo(CX + eyeX - 6, eyeY - 9); ctx.lineTo(CX + eyeX + 6, eyeY - 11); ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(CX - eyeX - 6, eyeY - 10); ctx.lineTo(CX - eyeX + 6, eyeY - 11); ctx.stroke();
    ctx.moveTo(CX + eyeX - 6, eyeY - 11); ctx.lineTo(CX + eyeX + 6, eyeY - 10); ctx.stroke();
  }

  // Mouth
  ctx.strokeStyle = '#444';
  ctx.lineWidth = 2.3;
  ctx.lineCap = 'round';
  if (mood === 'sleepy') {
    ctx.beginPath(); ctx.arc(CX, headCY + 13, 7, 0.1 * Math.PI, 0.9 * Math.PI); ctx.stroke();
  } else if (mood === 'excited' || mood === 'triumphant') {
    ctx.beginPath(); ctx.arc(CX, headCY + 10, 14, 0.12 * Math.PI, 0.88 * Math.PI); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.arc(CX, headCY + 11, 9, 0.1 * Math.PI, 0.9 * Math.PI); ctx.stroke();
  }
  ctx.restore();

  // Hat
  if (hasHat) {
    ctx.save();
    ctx.fillStyle = outfitColor;
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 1.5;
    const brimY = headCY - HEAD_R + 5;
    ctx.beginPath();
    ctx.ellipse(CX, brimY, 36, 8, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(CX, headCY - HEAD_R - 40);
    ctx.lineTo(CX - 29, brimY + 4);
    ctx.lineTo(CX + 29, brimY + 4);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  // Child name above character
  const nameY = headCY - HEAD_R - (hasHat ? 52 : 9);
  ctx.save();
  ctx.font = 'bold 29px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.shadowBlur = 11;
  ctx.shadowColor = GOLD;
  ctx.fillStyle = GOLD;
  ctx.fillText(char.child_name, CX, nameY);
  ctx.restore();

  // Sidekick
  const sk = (char.sidekick ?? '').toLowerCase();
  if (sk && sk !== 'none') {
    const emoji = SIDEKICK_MAP[sk] ?? '✨';
    const skX = CX + HEAD_R + 72 + Math.sin(t * Math.PI * 1.1) * 7;
    const skY = headCY + 10 + Math.sin(t * Math.PI * 1.4) * 9;
    ctx.save();
    ctx.font = '44px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, skX, skY);
    ctx.restore();
  }

  // Narration box
  const boxX = 20;
  const boxY = H - 189;
  const boxW = W - 40;
  const boxH = 170;
  const pad = 16;
  const r = 12;

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,12,0.68)';
  ctx.beginPath();
  ctx.moveTo(boxX + r, boxY);
  ctx.arcTo(boxX + boxW, boxY, boxX + boxW, boxY + boxH, r);
  ctx.arcTo(boxX + boxW, boxY + boxH, boxX, boxY + boxH, r);
  ctx.arcTo(boxX, boxY + boxH, boxX, boxY, r);
  ctx.arcTo(boxX, boxY, boxX + boxW, boxY, r);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,215,0,0.45)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.font = '21px Arial, sans-serif';
  ctx.fillStyle = 'white';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const lines = wrapText(ctx, scene.narration, boxW - pad * 2);
  const lineH = 27;
  const totalH = lines.length * lineH;
  const ty = boxY + (boxH - totalH) / 2;
  ctx.shadowBlur = 3;
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  lines.forEach((line, i) => ctx.fillText(line, W / 2, ty + i * lineH));
  ctx.restore();

  // Fade overlay
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

  // Pre-load one background per scene
  const used = new Set<number>();
  const bgs: Image[] = [];
  for (let i = 0; i < story.scenes.length; i++) {
    bgs.push(await loadBg(theme, used));
  }

  // Spawn ffmpeg reading raw RGBA frames from stdin, upscaling to 1080x1920
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

        drawFrame(ctx, bg, char, scene, f, Math.min(1, Math.max(0, fadeAlpha)));

        const raw = Buffer.from(ctx.getImageData(0, 0, W, H).data.buffer);
        const ok = ff.stdin.write(raw);
        if (!ok) await new Promise<void>(r => ff.stdin.once('drain', r));
      }
    }
  } finally {
    ff.stdin.end();
  }

  await done;
  return outPath;
}
