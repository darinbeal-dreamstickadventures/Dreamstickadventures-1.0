import express from 'express';
import cors from 'cors';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set');
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/character', async (req, res): Promise<void> => {
  try {
    const {
      parent_email, child_name, child_age, build,
      hair_style, hair_color, skin_tone, outfit_color,
      glow_color, accessories, sidekick, theme, subscription_status
    } = req.body;

    const result = await pool.query(
      `INSERT INTO characters
        (parent_email, child_name, child_age, build, hair_style, hair_color,
         skin_tone, outfit_color, glow_color, accessories, sidekick, theme, subscription_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id`,
      [parent_email, child_name, child_age, build, hair_style, hair_color,
       skin_tone, outfit_color, glow_color, accessories, sidekick, theme,
       subscription_status ?? 'waitlist']
    );

    res.json({ success: true, id: result.rows[0].id });
  } catch (e: any) {
    console.error('Server error:', e);
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('DreamStick Adventures server running on port ' + PORT);
});
