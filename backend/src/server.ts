import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { Pool } from 'pg';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL, ssl: /sslmode=require/.test(DATABASE_URL) ? { rejectUnauthorized: false } : undefined });

app.get('/health', (_req, res) => res.json({ ok: true }));

// Upsert user (id, email, name, imageUrl)
app.post('/api/db/users', async (req, res) => {
  try {
    const { id, email, name, imageUrl } = req.body || {};
    if (!id || !email || !name) return res.status(400).json({ error: 'missing_fields' });
    const q = `
      INSERT INTO public."Users" (id, email, name, "imageUrl", "createdAt")
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        name = EXCLUDED.name,
        "imageUrl" = EXCLUDED."imageUrl"
      RETURNING id, email, name, "imageUrl";
    `;
    const { rows } = await pool.query(q, [id, email, name, imageUrl || null]);
    res.json({ ok: true, row: rows[0] });
  } catch (e: any) {
    console.error('upsert user failed', e?.message || e);
    res.status(500).json({ error: 'internal_error' });
  }
});

// Upsert social connection
app.post('/api/db/social-connections', async (req, res) => {
  try {
    const { userId, provider, providerId, email, name } = req.body || {};
    if (!userId || !provider || !providerId) return res.status(400).json({ error: 'missing_fields' });
    const id = `${provider}:${providerId}`;
    const q = `
      INSERT INTO public."SocialConnections" (id, "userId", provider, "providerId", email, name, "createdAt")
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (id) DO UPDATE SET
        "userId" = EXCLUDED."userId",
        provider = EXCLUDED.provider,
        "providerId" = EXCLUDED."providerId",
        email = EXCLUDED.email,
        name = EXCLUDED.name
      RETURNING id, "userId", provider, "providerId", email, name;
    `;
    const { rows } = await pool.query(q, [id, userId, provider, providerId, email || null, name || null]);
    res.json({ ok: true, row: rows[0] });
  } catch (e: any) {
    console.error('upsert social connection failed', e?.message || e);
    res.status(500).json({ error: 'internal_error' });
  }
});

// Get connections for a user & provider
app.get('/api/db/social-connections/:userId/:provider', async (req, res) => {
  try {
    const { userId, provider } = req.params;
    const q = `SELECT id, "userId", provider, "providerId", email, name FROM public."SocialConnections" WHERE "userId"=$1 AND provider=$2 ORDER BY "createdAt" DESC LIMIT 5;`;
    const { rows } = await pool.query(q, [userId, provider]);
    res.json({ ok: true, rows });
  } catch (e: any) {
    console.error('fetch social connections failed', e?.message || e);
    res.status(500).json({ error: 'internal_error' });
  }
});

const PORT = process.env.PORT || 18911;
app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});
