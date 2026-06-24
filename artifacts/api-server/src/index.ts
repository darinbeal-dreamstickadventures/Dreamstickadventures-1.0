import express from 'express';
import cors from 'cors';
import pg from 'pg';
import Stripe from 'stripe';
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

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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

// ── Health ───────────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// ── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('DreamStick Adventures server running on port ' + PORT);
});
