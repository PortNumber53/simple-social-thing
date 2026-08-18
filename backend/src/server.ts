import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { Pool } from 'pg';
import rateLimit from 'express-rate-limit';

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

// Rate limiter factory for database-accessing routes.
// Each route gets its own instance so that hitting the limit on one route
// does not block access to other routes.
function createDbRateLimiter() {
  return rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: Number(process.env.RATE_LIMIT_MAX) || 30, // 30 requests per minute per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'too_many_requests' },
  });
}

app.get('/health', (_req, res) => res.json({ ok: true }));

// Upsert user (id, email, name, imageUrl)
app.post('/api/db/users', createDbRateLimiter(), async (req, res) => {
  try {
    const { id, email, name, imageUrl } = req.body || {};
    if (!id || !email || !name) return res.status(400).json({ error: 'missing_fields' });
    const q = `
      INSERT INTO public.users (id, email, name, image_url, created_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        name = EXCLUDED.name,
        image_url = EXCLUDED.image_url
      RETURNING id, email, name, image_url;
    `;
    const { rows } = await pool.query(q, [id, email, name, imageUrl || null]);
    res.json({ ok: true, row: rows[0] });
  } catch (e: any) {
    console.error('upsert user failed', e?.message || e);
    res.status(500).json({ error: 'internal_error' });
  }
});

// Upsert social connection
app.post('/api/db/social-connections', createDbRateLimiter(), async (req, res) => {
  try {
    const { userId, provider, providerId, email, name } = req.body || {};
    if (!userId || !provider || !providerId) return res.status(400).json({ error: 'missing_fields' });
    const id = `${provider}:${providerId}`;
    const q = `
      INSERT INTO public.social_connections (id, user_id, provider, provider_id, email, name, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (id) DO UPDATE SET
        user_id = EXCLUDED.user_id,
        provider = EXCLUDED.provider,
        provider_id = EXCLUDED.provider_id,
        email = EXCLUDED.email,
        name = EXCLUDED.name
      RETURNING id, user_id, provider, provider_id, email, name;
    `;
    const { rows } = await pool.query(q, [id, userId, provider, providerId, email || null, name || null]);
    res.json({ ok: true, row: rows[0] });
  } catch (e: any) {
    console.error('upsert social connection failed', e?.message || e);
    res.status(500).json({ error: 'internal_error' });
  }
});

// Get connections for a user & provider
app.get('/api/db/social-connections/:userId/:provider', createDbRateLimiter(), async (req, res) => {
  try {
    const { userId, provider } = req.params;
    const q = `SELECT id, user_id, provider, provider_id, email, name FROM public.social_connections WHERE user_id=$1 AND provider=$2 ORDER BY created_at DESC LIMIT 5;`;
    const { rows } = await pool.query(q, [userId, provider]);
    res.json({ ok: true, rows });
  } catch (e: any) {
    console.error('fetch social connections failed', e?.message || e);
    res.status(500).json({ error: 'internal_error' });
  }
});

export { app, pool };

// Start the server only when this file is run directly (not imported for testing).
const isMainModule = process.argv[1] && import.meta.url &&
  (import.meta.url === `file://${process.argv[1]}` ||
   import.meta.url === `file://${process.argv[1]}.ts` ||
   process.argv[1].endsWith('server.ts') ||
   process.argv[1].endsWith('server.js'));
if (isMainModule) {
  const PORT = process.env.PORT || 18911;
  app.listen(PORT, () => {
    console.log(`Backend listening on http://localhost:${PORT}`);
  });
}
