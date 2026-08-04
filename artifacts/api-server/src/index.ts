import { setDefaultResultOrder } from 'dns';
setDefaultResultOrder('ipv4first');

import express from 'express';
import cors from 'cors';
import pg from 'pg';
import Stripe from 'stripe';
import Anthropic from '@anthropic-ai/sdk';
import cron from 'node-cron';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { renderVideo } from './renderer.js';
import { generateStoryAudio, generateSceneAudio } from './narration.js';
import { sendVideoReadyEmail, sendConfirmationEmail } from './email.js';
import { objectStorageClient } from './lib/objectStorage.js';

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

// ffmpeg and ffprobe are provided by pkgs.ffmpeg in replit.nix (Nix layer)
// and available on PATH automatically — no PATH manipulation needed.

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
// Trust the first hop from Replit's reverse proxy so req.ip / X-Forwarded-For
// reflect the real visitor IP rather than the internal proxy address.
// Without this, every user looks identical to the rate limiter.
app.set('trust proxy', 1);
app.use(cors());

// ── Stripe webhook (must come before express.json — needs raw body for sig verification) ──
app.post('/api/stripe-webhook', express.raw({ type: 'application/json' }), async (req, res): Promise<void> => {
  const sig = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secret) {
    console.error('[webhook] STRIPE_WEBHOOK_SECRET not set — ignoring event');
    res.status(500).json({ error: 'Webhook secret not configured' });
    return;
  }

  let event: import('stripe').Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig as string, secret);
  } catch (e: any) {
    console.error('[webhook] Signature verification failed:', e.message);
    res.status(400).json({ error: `Webhook signature invalid: ${e.message}` });
    return;
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as import('stripe').Stripe.Checkout.Session;
    const email = session.metadata?.email ?? session.customer_details?.email ?? null;
    const plan  = session.metadata?.plan ?? 'unknown';

    if (email && (session.payment_status === 'paid' || session.status === 'complete')) {
      try {
        const result = await pool.query(
          `UPDATE characters SET subscription_status = 'active'
           WHERE parent_email = $1 AND subscription_status != 'active'`,
          [email.toLowerCase().trim()],
        );
        console.log(`[webhook] Activated ${result.rowCount} character(s) for ${email} (plan: ${plan})`);
      } catch (e: any) {
        console.error('[webhook] DB update failed:', e.message);
        res.status(500).json({ error: 'DB update failed' });
        return;
      }
    } else {
      console.warn(`[webhook] checkout.session.completed — no email or unpaid (status: ${session.payment_status})`);
    }
  }

  res.json({ received: true });
});

app.use(express.json());

// ── Static pages (public/ lives one level above src/) ────────────────────────

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// ── Static asset hosting (backgrounds + characters for Shotstack / renderer) ──
// On Railway the monorepo root is deployed, so dreamstick/public/ is present.
const DREAMSTICK_PUBLIC = path.join(__dirname, '..', '..', 'dreamstick', 'public');
app.use('/backgrounds', express.static(path.join(DREAMSTICK_PUBLIC, 'backgrounds')));
app.use('/characters',  express.static(path.join(DREAMSTICK_PUBLIC, 'characters')));

app.get('/pricing', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'pricing.html'));
});

app.get('/form', (_req, res) => {
  res.redirect(301, '/free');
});

app.get('/free', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'free.html'));
});

// /sample — plays the Liam demo video with a CTA to claim a free story
app.get('/sample', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'sample.html'));
});

app.get('/privacy', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'privacy.html'));
});

app.get('/terms', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'terms.html'));
});

// ── Stripe checkout ──────────────────────────────────────────────────────────

app.post('/api/create-checkout-session', async (req, res): Promise<void> => {
  const plan  = (req.body.plan as string)?.toLowerCase();
  const email = (req.body.email as string)?.trim().toLowerCase();
  const priceId = PRICE_IDS[plan];

  if (!plan || !priceId) {
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
      ...(email ? { customer_email: email } : {}),
      metadata: { plan, ...(email ? { email } : {}) },
      success_url: `${origin}/api/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${origin}/api/cancel`,
    });

    res.json({ url: session.url });
  } catch (e: any) {
    console.error('Stripe error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Post-payment redirects ───────────────────────────────────────────────────

// Retrieve the completed session server-side (never trust client-supplied
// status) and flip the matching character(s) to active before sending the
// subscriber on to the character builder.
app.get('/api/success', async (req, res): Promise<void> => {
  const sessionId = req.query.session_id as string | undefined;

  if (sessionId) {
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const email = session.metadata?.email ?? session.customer_details?.email ?? undefined;
      const plan  = session.metadata?.plan;

      if (session.payment_status === 'paid' || session.status === 'complete') {
        if (email) {
          const result = await pool.query(
            `UPDATE characters SET subscription_status = 'active'
             WHERE parent_email = $1 AND subscription_status != 'active'`,
            [email.toLowerCase().trim()],
          );
          console.log(`[stripe] Activated ${result.rowCount} character(s) for ${email} (plan: ${plan})`);
        } else {
          console.warn(`[stripe] Checkout session ${sessionId} completed but no email in metadata — could not activate a character`);
        }
      }
    } catch (e: any) {
      console.error('[stripe] Failed to reconcile checkout session:', e.message);
    }
  }

  res.redirect('/form');
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
  parent_email?: string;
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

app.get('/api/test-story', async (req, res): Promise<void> => {
  const adminToken = process.env.ADMIN_SECRET_TOKEN;
  if (!adminToken || req.headers['x-admin-token'] !== adminToken) {
    res.status(401).json({ error: 'Unauthorized' }); return;
  }
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
  parentEmail?: string;
  childName?: string;
  theme?: string;
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

async function uploadVideoToGCS(localPath: string, filename: string): Promise<void> {
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!bucketId) throw new Error('DEFAULT_OBJECT_STORAGE_BUCKET_ID not set');
  const bucket = objectStorageClient.bucket(bucketId);
  await bucket.upload(localPath, {
    destination: `videos/${filename}`,
    contentType: 'video/mp4',
    metadata: { cacheControl: 'public, max-age=86400' },
  });
  console.log(`[gcs] Uploaded ${filename} to bucket ${bucketId}`);
}

async function streamVideoFromGCS(filename: string, res: import('express').Response): Promise<boolean> {
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!bucketId) return false;
  try {
    const bucket = objectStorageClient.bucket(bucketId);
    const file = bucket.file(`videos/${filename}`);
    const [exists] = await file.exists();
    if (!exists) return false;
    const [meta] = await file.getMetadata();
    res.setHeader('Content-Type', 'video/mp4');
    if (meta.size) res.setHeader('Content-Length', String(meta.size));
    res.setHeader('Cache-Control', 'public, max-age=86400');
    await new Promise<void>((resolve, reject) => {
      file.createReadStream()
        .on('error', reject)
        .pipe(res)
        .on('finish', resolve)
        .on('error', reject);
    });
    return true;
  } catch {
    return false;
  }
}

function buildWatchUrl(filename: string): string {
  const customDomain = process.env.WATCH_DOMAIN?.trim();
  if (customDomain) return `https://${customDomain}/api/watch/${filename}`;
  const replitDomain = (process.env.REPLIT_DOMAINS ?? '').split(',')[0].trim();
  return `https://${replitDomain}/api/watch/${filename}`;
}

async function runRenderJob(job: RenderJob, char: Character): Promise<void> {
  let audioPath: string | undefined;
  try {
    job.status = 'generating';
    console.log(`[job:${job.id}] Generating story for ${char.child_name}...`);
    const story = await generateStory(char);
    job.story = story;

    // ── Narration (optional — skipped if keys not configured) ──────────────
    let sceneDursSec: number[] | undefined;
    if (NARRATION_ENABLED) {
      console.log(`[job:${job.id}] Generating ElevenLabs narration...`);
      try {
        const result = await generateStoryAudio(story.scenes);
        audioPath    = result.audioPath;
        sceneDursSec = result.sceneDursSec;
        console.log(`[job:${job.id}] Narration ready → ${audioPath}`);
      } catch (audioErr: any) {
        console.error(`[job:${job.id}] Narration failed (continuing without audio):`, audioErr.message);
        audioPath    = undefined;
        sceneDursSec = undefined;
      }
    } else {
      console.log(`[job:${job.id}] Skipping narration (ELEVENLABS keys not set)`);
    }

    job.status = 'rendering';
    console.log(`[job:${job.id}] Rendering ${story.scenes.length} scenes × 30fps...`);
    const filePath = await renderVideo(char, story, audioPath, sceneDursSec);
    const filename = path.basename(filePath);

    job.url = `/api/videos/${filename}`;
    job.status = 'done';
    console.log(`[job:${job.id}] Done → ${job.url}`);

    // ── Upload to GCS for persistent storage ───────────────────────────────
    uploadVideoToGCS(filePath, filename).catch((e: any) =>
      console.error(`[gcs] Upload failed (video still served from disk): ${e.message}`)
    );

    // ── Email delivery (non-fatal) ──────────────────────────────────────────
    if (job.parentEmail) {
      const watchUrl = buildWatchUrl(filename);
      sendVideoReadyEmail({
        toEmail:   job.parentEmail,
        childName: job.childName ?? char.child_name,
        theme:     job.theme ?? char.theme ?? 'adventure',
        watchUrl,
      }).catch(() => {});
    }
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

// ── Nightly scheduler (7pm Mountain Time) ────────────────────────────────────
//
// Every night, renders and emails a fresh story to every active subscriber.
// Runs each subscriber through the exact same story → narration → render →
// upload → email pipeline as an on-demand job, but sequentially (one at a
// time) rather than fire-and-forget, so a slow/failed render for one
// subscriber can't fan out into unbounded concurrent ffmpeg processes.
async function runNightlyJobForCharacter(char: Character & { id: number }): Promise<void> {
  const job: RenderJob = {
    id: randomUUID(), status: 'pending', created: Date.now(),
    parentEmail: char.parent_email,
    childName:   char.child_name,
    theme:       char.theme,
  };
  jobs.set(job.id, job);

  await runRenderJob(job, char);

  if (job.status !== 'done') {
    throw new Error(job.error ?? 'render job did not complete');
  }

  await pool.query(
    `UPDATE characters SET last_video_sent_at = now() WHERE id = $1`,
    [char.id],
  );
}

async function runNightlyScheduler(): Promise<void> {
  const startedAt = Date.now();
  console.log(`[scheduler] Nightly run starting at ${new Date(startedAt).toISOString()}`);

  let subscribers: (Character & { id: number })[] = [];
  try {
    const result = await pool.query(
      `SELECT * FROM characters WHERE subscription_status = 'active' ORDER BY id ASC`,
    );
    subscribers = result.rows as (Character & { id: number })[];
  } catch (e: any) {
    console.error('[scheduler] Failed to load active subscribers, aborting run:', e.message);
    return;
  }

  let success = 0;
  let failures = 0;
  const failureDetails: { characterId: number; email: string; error: string }[] = [];

  for (const char of subscribers) {
    try {
      console.log(`[scheduler] Processing character ${char.id} (${char.child_name} / ${char.parent_email})...`);
      await runNightlyJobForCharacter(char);
      success++;
    } catch (e: any) {
      failures++;
      failureDetails.push({ characterId: char.id, email: char.parent_email ?? 'unknown', error: e.message });
      console.error(`[scheduler] Character ${char.id} (${char.parent_email}) failed:`, e.message);
      // Continue on to the next subscriber — one failure must never block the rest of the run.
    }
  }

  const durationSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `[scheduler] Nightly run complete in ${durationSec}s — processed=${subscribers.length} success=${success} failures=${failures}`,
  );
  if (failureDetails.length > 0) {
    console.error('[scheduler] Failure details:', JSON.stringify(failureDetails));
  }
}

// Runs at 7:00 PM Mountain Time every night (node-cron resolves DST via the IANA zone).
cron.schedule('0 19 * * *', () => {
  runNightlyScheduler().catch((e: any) => console.error('[scheduler] Unhandled error in nightly run:', e.message));
}, { timezone: 'America/Denver' });

// Manual trigger for testing the nightly pipeline without waiting for 7pm.
// Protected by a secret token supplied in the X-Admin-Token header.
app.post('/api/admin/run-nightly-scheduler', async (req, res): Promise<void> => {
  const adminToken = process.env.ADMIN_SECRET_TOKEN;
  if (!adminToken || req.headers['x-admin-token'] !== adminToken) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  runNightlyScheduler().catch((e: any) => console.error('[scheduler] Unhandled error in manual run:', e.message));
  res.json({ success: true, message: 'Nightly scheduler run started in the background — check server logs for progress.' });
});

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

    const job: RenderJob = {
      id: randomUUID(), status: 'pending', created: Date.now(),
      parentEmail: char.parent_email,
      childName:   char.child_name,
      theme:       char.theme,
    };
    jobs.set(job.id, job);

    // Fire-and-forget — render continues even if client disconnects
    runRenderJob(job, char).catch(() => {});

    res.json({ success: true, job_id: job.id, status: 'pending' });
  } catch (e: any) {
    console.error('render-video error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Free sample video ─────────────────────────────────────────────────────────

// In-memory per-IP rate limit: 1 free-video request per IP per hour.
// A plain Map is sufficient here — this is a single-instance API server with
// no horizontal scaling, and the limit only needs to survive within a process.
const FREE_VIDEO_IP_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const freeVideoIpRequests = new Map<string, number>(); // ip -> last request timestamp

// Periodically sweep stale entries so the map doesn't grow unbounded
setInterval(() => {
  const cutoff = Date.now() - FREE_VIDEO_IP_WINDOW_MS;
  for (const [ip, ts] of freeVideoIpRequests) {
    if (ts < cutoff) freeVideoIpRequests.delete(ip);
  }
}, 15 * 60 * 1000);

function getClientIp(req: express.Request): string {
  // Trust X-Forwarded-For's first entry when present (behind Replit's proxy),
  // otherwise fall back to the socket address.
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim();
  return req.socket.remoteAddress ?? 'unknown';
}

app.post('/api/free-video', async (req, res): Promise<void> => {
  const ip = getClientIp(req);

  try {
    const { child_name, character_type, theme, parent_email, child_age } = req.body as {
      child_name: string;
      character_type?: string;
      theme: string;
      parent_email: string;
      child_age?: number;
    };

    if (!child_name || !theme || !parent_email) {
      res.status(400).json({ error: 'child_name, theme, and parent_email are required' });
      return;
    }

    // ── Testing bypass — skip all limits for this address ─────────────────
    const isBypassEmail = parent_email.toLowerCase().trim() === 'darinbeal@gmail.com';

    // ── Rate limit: 1 request per IP per hour ─────────────────────────────
    if (!isBypassEmail) {
      const lastRequest = freeVideoIpRequests.get(ip);
      if (lastRequest !== undefined && Date.now() - lastRequest < FREE_VIDEO_IP_WINDOW_MS) {
        console.warn(`[free-video] Rate limit violation — ip=${ip} at ${new Date().toISOString()}`);
        res.status(429).json({
          success: false,
          error: 'You have already requested a free video recently. Please check your inbox or try again later.',
        });
        return;
      }
    }

    // Check if this email has already claimed a free video (max 1 per email, ever)
    if (!isBypassEmail) {
      const existing = await pool.query(
        `SELECT id FROM characters WHERE parent_email = $1 AND subscription_status = 'free-sample' LIMIT 1`,
        [parent_email.toLowerCase().trim()],
      );
      if (existing.rows.length > 0) {
        res.json({ success: true, already_claimed: true });
        return;
      }
    }

    // Only mark the IP as "used" once we know the request will actually
    // trigger a render (an already-claimed email doesn't burn the IP's slot).
    freeVideoIpRequests.set(ip, Date.now());

    // Default to 6 when the form doesn't collect an age — avoids the
    // child_age NOT NULL constraint violation.
    const resolvedAge = Number.isFinite(child_age) && (child_age as number) > 0 ? Number(child_age) : 6;

    // Save character to DB
    const insertResult = await pool.query(
      `INSERT INTO characters (parent_email, child_name, child_age, character_type, build, sidekick, theme, subscription_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'free-sample')
       RETURNING id`,
      [
        parent_email.toLowerCase().trim(),
        child_name.trim(),
        resolvedAge,
        character_type ?? 'boy',
        'average',
        'dragon',
        theme,
      ],
    );

    const char: Character = {
      child_name: child_name.trim(),
      child_age:  resolvedAge,
      character_type: character_type ?? 'boy',
      build:    'average',
      sidekick: 'dragon',
      theme,
    };

    const job: RenderJob = {
      id: randomUUID(), status: 'pending', created: Date.now(),
      parentEmail: parent_email.toLowerCase().trim(),
      childName:   child_name.trim(),
      theme,
    };
    jobs.set(job.id, job);

    // Fire confirmation email immediately — before rendering starts — so the
    // parent knows the video is on its way and can close the tab.
    sendConfirmationEmail({
      toEmail:   parent_email.toLowerCase().trim(),
      childName: child_name.trim(),
      theme,
    }).catch((e: unknown) => console.error('[free-video] confirmation email failed:', (e as Error).message));

    runRenderJob(job, char).catch(() => {});

    res.json({ success: true, already_claimed: false, job_id: job.id, character_id: insertResult.rows[0].id });
  } catch (e: any) {
    console.error('[free-video] error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// Start a test render job (Kevin, no DB)
app.post('/api/test-video', async (req, res): Promise<void> => {
  const adminToken = process.env.ADMIN_SECRET_TOKEN;
  if (!adminToken || req.headers['x-admin-token'] !== adminToken) {
    res.status(401).json({ error: 'Unauthorized' }); return;
  }
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
  const filename = path.basename(req.params.filename);
  const filePath = path.join(VIDEOS_DIR, filename);

  // Check file exists locally or in GCS before rendering the page
  let videoExists = false;
  try { await fs.access(filePath); videoExists = true; } catch { /* check GCS */ }
  if (!videoExists) {
    try {
      const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
      if (bucketId) {
        const [exists] = await objectStorageClient.bucket(bucketId).file(`videos/${filename}`).exists();
        videoExists = exists;
      }
    } catch { /* fall through */ }
  }

  if (!videoExists) {
    res.status(404).send('<h1>Video not found</h1>');
    return;
  }

  try {
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

// Serve completed video files — local /tmp first, then GCS fallback
app.get('/api/videos/:filename', async (req, res): Promise<void> => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(VIDEOS_DIR, filename);

  // Try local /tmp first (fast, available right after render)
  try {
    await fs.access(filePath);
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(filePath);
    return;
  } catch {
    // File not on disk — fall through to GCS
  }

  // Fall back to GCS (persists across restarts)
  const served = await streamVideoFromGCS(filename, res);
  if (!served) {
    res.status(404).json({ error: 'Video not found' });
  }
});

// ── Test narration (audio only, no video render) ──────────────────────────────

app.get('/api/test-narration', async (req, res): Promise<void> => {
  const adminToken = process.env.ADMIN_SECRET_TOKEN;
  if (!adminToken || req.headers['x-admin-token'] !== adminToken) {
    res.status(401).json({ error: 'Unauthorized' }); return;
  }
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
    const { audioPath } = await generateStoryAudio(story.scenes);

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
