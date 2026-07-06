import express from 'express';
import cors from 'cors';
import pg from 'pg';
import Stripe from 'stripe';
import Anthropic from '@anthropic-ai/sdk';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { renderVideo } from './renderer.js';
import { generateStoryAudio, generateSceneAudio } from './narration.js';

// Prevent EPIPE / unhandled async rejection from crashing the server
process.on('uncaughtException', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE' || err.code === 'ECONNRESET') return;
  console.error('[uncaughtException]', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set');
}
if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY must be set');
}
if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error('ANTHROPIC_API_KEY must be set');
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const PRICE_IDS: Record<string, string> = {
  dreamer: process.env.STRIPE_DREAMER_PRICE_ID ?? '',
  nightly: process.env.STRIPE_NIGHTLY_PRICE_ID ?? '',
  family:  process.env.STRIPE_FAMILY_PRICE_ID  ?? '',
};

const app = express();
app.use(cors());
app.use(express.json());

// ── Pricing page ─────────────────────────────────────────────────────────────

app.get('/pricing', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pricing.html'));
});

// ── Stripe checkout ──────────────────────────────────────────────────────────

app.post('/api/create-checkout-session', async (req, res): Promise<void> => {
  const plan = (req.body.plan as string)?.toLowerCase();
  const priceId = PRICE_IDS[plan];

  if (!priceId) {
    res.status(400).json({ error: `Unknown plan: ${plan}` });
    return;
  }

  const origin =
    req.headers.origin ??
    `https://${(process.env.REPLIT_DOMAINS ?? '').split(',')[0].trim()}`;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/api/success`,
      cancel_url:  `${origin}/api/cancel`,
    });

    res.json({ url: session.url });
  } catch (e: any) {
    console.error('Stripe error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Post-payment redirects ───────────────────────────────────────────────────

app.get('/api/success', (_req, res) => {
  res.redirect('/build');
});

app.get('/api/cancel', (_req, res) => {
  res.redirect('/pricing');
});

// ── Character save ───────────────────────────────────────────────────────────

app.post('/api/character', async (req, res): Promise<void> => {
  try {
    const {
      parent_email, child_name, child_age, character_type, build,
      hair_style, hair_color, skin_tone, outfit_color,
      glow_color, accessories, sidekick, theme, subscription_status,
    } = req.body;

    const result = await pool.query(
      `INSERT INTO characters
        (parent_email, child_name, child_age, character_type, build, hair_style, hair_color,
         skin_tone, outfit_color, glow_color, accessories, sidekick, theme, subscription_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING id`,
      [parent_email, child_name, child_age, character_type ?? 'boy', build, hair_style, hair_color,
       skin_tone, outfit_color, glow_color, accessories, sidekick, theme,
       subscription_status ?? 'waitlist'],
    );

    res.json({ success: true, id: result.rows[0].id });
  } catch (e: any) {
    console.error('Server error:', e);
    res.json({ success: false, error: e.message });
  }
});

// ── Story generator ──────────────────────────────────────────────────────────

const VALID_MOODS = ['excited', 'curious', 'brave', 'triumphant', 'peaceful', 'sleepy'] as const;
type Mood = typeof VALID_MOODS[number];

interface Scene {
  scene_number: number;
  duration: number;
  narration: string;
  mood: Mood;
}

interface Story {
  title: string;
  scenes: Scene[];
}

interface Character {
  child_name: string;
  child_age: number;
  character_type?: string;
  build?: string;
  hair_style?: string;
  hair_color?: string;
  outfit_color?: string;
  glow_color?: string;
  accessories?: string;
  sidekick?: string;
  theme?: string;
}

function buildStoryPrompt(char: Character): string {
  const sidekickDesc = char.sidekick && char.sidekick !== 'none'
    ? `Their loyal sidekick is a ${char.sidekick}.`
    : 'They adventure alone.';

  const accessoryDesc = char.accessories && char.accessories !== 'none'
    ? `wearing ${char.accessories}`
    : '';

  return `You are a magical bedtime story writer for children. Write a personalized 2-minute bedtime story for a child.

Child details:
- Name: ${char.child_name}
- Age: ${char.child_age} years old
- Build: ${char.build ?? 'average'}
- Hair: ${char.hair_style ?? 'short'} style
- Outfit: glowing ${char.outfit_color ?? 'purple'} colours${accessoryDesc ? ', ' + accessoryDesc : ''}
- Adventure theme: ${char.theme ?? 'space'}
- ${sidekickDesc}

Write exactly 6 scenes. Each scene is 20 seconds of narration (2-3 sentences). The story must:
1. Start with excitement or curiosity to draw the child in
2. Build through adventure with brave moments
3. End peacefully with the LAST scene always having a "sleepy" mood

Respond with ONLY valid JSON in this exact format (no markdown, no extra text):
{
  "title": "Story title here",
  "scenes": [
    {
      "scene_number": 1,
      "duration": 20,
      "narration": "2-3 sentence narration here.",
      "mood": "excited"
    }
  ]
}

Valid moods: excited, curious, brave, triumphant, peaceful, sleepy.
The 6th scene MUST have mood "sleepy". Use each child's name (${char.child_name}) naturally in the narration.`;
}

async function generateStory(char: Character): Promise<Story> {
  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 8192,
    messages: [{ role: 'user', content: buildStoryPrompt(char) }],
  });

  const raw = message.content[0];
  if (raw.type !== 'text') throw new Error('Unexpected response type from Claude');

  let story: Story;
  try {
    const cleaned = raw.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    story = JSON.parse(cleaned) as Story;
  } catch {
    throw new Error('Claude returned invalid JSON: ' + raw.text.substring(0, 200));
  }

  if (!story.title || !Array.isArray(story.scenes) || story.scenes.length !== 6) {
    throw new Error('Story structure invalid — expected title and 6 scenes');
  }

  story.scenes.forEach((s, i) => {
    s.scene_number = i + 1;
    s.duration = 20;
    if (!VALID_MOODS.includes(s.mood)) s.mood = i === 5 ? 'sleepy' : 'peaceful';
  });

  story.scenes[5].mood = 'sleepy';

  return story;
}

app.post('/api/generate-story', async (req, res): Promise<void> => {
  try {
    const char = req.body as Character;
    if (!char.child_name || !char.child_age) {
      res.status(400).json({ error: 'child_name and child_age are required' });
      return;
    }
    const story = await generateStory(char);
    res.json({ success: true, story });
  } catch (e: any) {
    console.error('Story generation error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/test-story', async (_req, res): Promise<void> => {
  try {
    const testChar: Character = {
      child_name: 'Kevin',
      child_age: 6,
      build: 'average',
      hair_style: 'short',
      hair_color: '#3a1e08',
      outfit_color: '#9b59b6',
      glow_color: '#f7e96b',
      accessories: 'cape',
      sidekick: 'dragon',
      theme: 'space',
    };
    const story = await generateStory(testChar);
    res.json({ success: true, story });
  } catch (e: any) {
    console.error('Test story error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Video renderer (async job queue) ─────────────────────────────────────────

const VIDEOS_DIR = '/tmp/dreamstick-videos';

type JobStatus = 'pending' | 'generating' | 'rendering' | 'done' | 'error';

interface RenderJob {
  id: string;
  status: JobStatus;
  created: number;
  url?: string;
  story?: Story;
  error?: string;
}

const jobs = new Map<string, RenderJob>();

// Clean up jobs older than 2 hours
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, job] of jobs) {
    if (job.created < cutoff) jobs.delete(id);
  }
}, 15 * 60 * 1000);

const NARRATION_ENABLED =
  !!process.env.ELEVENLABS_API_KEY && !!process.env.ELEVENLABS_VOICE_ID;

async function runRenderJob(job: RenderJob, char: Character): Promise<void> {
  let audioPath: string | undefined;
  try {
    job.status = 'generating';
    console.log(`[job:${job.id}] Generating story for ${char.child_name}...`);
    const story = await generateStory(char);
    job.story = story;

    // ── Narration (optional — skipped if keys not configured) ──────────────
    if (NARRATION_ENABLED) {
      console.log(`[job:${job.id}] Generating ElevenLabs narration...`);
      try {
        audioPath = await generateStoryAudio(story.scenes);
        console.log(`[job:${job.id}] Narration ready → ${audioPath}`);
      } catch (audioErr: any) {
        console.error(`[job:${job.id}] Narration failed (continuing without audio):`, audioErr.message);
        audioPath = undefined;
      }
    } else {
      console.log(`[job:${job.id}] Skipping narration (ELEVENLABS keys not set)`);
    }

    job.status = 'rendering';
    console.log(`[job:${job.id}] Rendering ${story.scenes.length} scenes × 30fps...`);
    const filePath = await renderVideo(char, story, audioPath);
    const filename = path.basename(filePath);

    job.url = `/api/videos/${filename}`;
    job.status = 'done';
    console.log(`[job:${job.id}] Done → ${job.url}`);
  } catch (e: any) {
    job.status = 'error';
    job.error = e.message;
    console.error(`[job:${job.id}] Failed:`, e.message);
  } finally {
    // Clean up narration temp file
    if (audioPath) {
      const fs2 = await import('fs/promises');
      await fs2.unlink(audioPath).catch(() => {});
    }
  }
}

// Start a render job for a DB character
app.post('/api/render-video', async (req, res): Promise<void> => {
  try {
    const { character_id } = req.body as { character_id: number };
    if (!character_id) {
      res.status(400).json({ error: 'character_id is required' });
      return;
    }

    const result = await pool.query('SELECT * FROM characters WHERE id = $1', [character_id]);
    if (result.rows.length === 0) {
      res.status(404).json({ error: `Character ${character_id} not found` });
      return;
    }
    const char = result.rows[0] as Character;

    const job: RenderJob = { id: randomUUID(), status: 'pending', created: Date.now() };
    jobs.set(job.id, job);

    // Fire-and-forget — render continues even if client disconnects
    runRenderJob(job, char).catch(() => {});

    res.json({ success: true, job_id: job.id, status: 'pending' });
  } catch (e: any) {
    console.error('render-video error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// Start a test render job (Kevin, no DB)
app.post('/api/test-video', async (req, res): Promise<void> => {
  const testChar: Character = {
    child_name: 'Kevin',
    child_age: 6,
    character_type: 'boy',
    build: 'average',
    hair_style: 'short',
    hair_color: '#3a1e08',
    outfit_color: '#9b59b6',
    glow_color: '#f7e96b',
    accessories: 'cape',
    sidekick: 'dragon',
    theme: 'space',
    ...(req.body as Partial<Character>),
  };

  const job: RenderJob = { id: randomUUID(), status: 'pending', created: Date.now() };
  jobs.set(job.id, job);
  runRenderJob(job, testChar).catch(() => {});

  res.json({ success: true, job_id: job.id, status: 'pending' });
});

// Poll job status
app.get('/api/render-status/:jobId', (req, res): void => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  res.json({
    job_id: job.id,
    status: job.status,
    url: job.url,
    story: job.story,
    error: job.error,
  });
});

// Watch page — self-contained HTML video player
app.get('/api/watch/:filename', async (req, res): Promise<void> => {
  try {
    const filename = path.basename(req.params.filename);
    const filePath = path.join(VIDEOS_DIR, filename);
    await fs.access(filePath);
    const videoUrl = `/api/videos/${filename}`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>DreamStick Adventures — Watch</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0a0015;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;font-family:system-ui,sans-serif}
h1{color:#FFD700;font-size:1.6rem;text-align:center;margin-bottom:6px;text-shadow:0 0 20px #FFD700}
p{color:#a78bfa;text-align:center;font-size:0.85rem;margin-bottom:20px}
.card{background:#12002a;border:1px solid #4c1d95;border-radius:20px;overflow:hidden;max-width:420px;width:100%;box-shadow:0 0 60px rgba(124,58,237,0.35)}
video{display:block;width:100%;background:#000}
.actions{padding:16px;display:flex;gap:10px}
a.dl{flex:1;display:block;padding:12px;border-radius:12px;background:#FFD700;color:#000;font-weight:700;text-align:center;text-decoration:none;font-size:1rem;transition:background .15s}
a.dl:hover{background:#fde047}
.meta{color:#6d28d9;font-size:0.75rem;text-align:center;padding-bottom:12px}
</style>
</head>
<body>
<h1>✨ DreamStick Adventures</h1>
<p>Your personalised bedtime story video</p>
<div class="card">
  <video src="${videoUrl}" controls playsinline preload="metadata"></video>
  <div class="actions">
    <a class="dl" href="${videoUrl}" download="${filename}">⬇️ Download MP4</a>
  </div>
  <div class="meta">1080 × 1920 · 30 fps · H.264 · 2 minutes</div>
</div>
</body>
</html>`);
  } catch {
    res.status(404).send('<h1>Video not found</h1>');
  }
});

// Serve completed video files
app.get('/api/videos/:filename', async (req, res): Promise<void> => {
  try {
    const filename = path.basename(req.params.filename);
    const filePath = path.join(VIDEOS_DIR, filename);
    await fs.access(filePath);
    res.setHeader('Content-Type', 'video/mp4');
    res.sendFile(filePath);
  } catch {
    res.status(404).json({ error: 'Video not found' });
  }
});

// ── Test narration (audio only, no video render) ──────────────────────────────

app.get('/api/test-narration', async (_req, res): Promise<void> => {
  if (!process.env.ELEVENLABS_API_KEY || !process.env.ELEVENLABS_VOICE_ID) {
    res.status(503).json({
      error: 'ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID must both be set',
    });
    return;
  }

  const testChar: Character = {
    child_name: 'Kevin',
    child_age:  6,
    sidekick:   'dragon',
    theme:      'space',
  };

  try {
    console.log('[test-narration] Generating story…');
    const story = await generateStory(testChar);

    console.log('[test-narration] Generating narration for all scenes…');
    const audioPath = await generateStoryAudio(story.scenes);

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', 'attachment; filename="kevin-narration.mp3"');

    const { createReadStream } = await import('fs');
    const stream = createReadStream(audioPath);
    stream.pipe(res);
    stream.on('end', async () => {
      await fs.unlink(audioPath).catch(() => {});
    });
    stream.on('error', async (err) => {
      console.error('[test-narration] stream error:', err.message);
      await fs.unlink(audioPath).catch(() => {});
      if (!res.headersSent) res.status(500).json({ error: err.message });
    });
  } catch (e: any) {
    console.error('[test-narration] error:', e.message);
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

// ── Health ───────────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// ── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('DreamStick Adventures server running on port ' + PORT);
});
