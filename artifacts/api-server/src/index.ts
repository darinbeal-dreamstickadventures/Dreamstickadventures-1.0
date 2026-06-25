import express from 'express';
import cors from 'cors';
import pg from 'pg';
import Stripe from 'stripe';
import Anthropic from '@anthropic-ai/sdk';
import path from 'path';
import { fileURLToPath } from 'url';

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
      parent_email, child_name, child_age, build,
      hair_style, hair_color, skin_tone, outfit_color,
      glow_color, accessories, sidekick, theme, subscription_status,
    } = req.body;

    const result = await pool.query(
      `INSERT INTO characters
        (parent_email, child_name, child_age, build, hair_style, hair_color,
         skin_tone, outfit_color, glow_color, accessories, sidekick, theme, subscription_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id`,
      [parent_email, child_name, child_age, build, hair_style, hair_color,
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

// ── Health ───────────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// ── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('DreamStick Adventures server running on port ' + PORT);
});
