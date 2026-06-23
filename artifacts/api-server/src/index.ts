import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Connect to Supabase
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

// Save character to Supabase
app.post('/character', async (req, res): Promise<void> => {
  try {
    const character = req.body;
    const { data, error } = await supabase
      .from('characters')
      .insert([character]);

    if (error) {
      console.error('Supabase error:', error);
      res.json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, data });
  } catch (e: any) {
    console.error('Server error:', e);
    res.json({ success: false, error: e.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'DreamStick Adventures backend is running' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('DreamStick Adventures server running on port ' + PORT);
});
