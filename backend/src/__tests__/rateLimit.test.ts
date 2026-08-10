import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock pg before importing the app.
vi.mock('pg', () => {
  const mockQuery = vi.fn(async () => ({ rows: [] }));
  class MockPool {
    query = mockQuery;
    end = vi.fn(async () => {});
  }
  return { Pool: MockPool as any, __mockQuery: mockQuery };
});

// Set environment for testing: dummy DB URL and low rate limit.
process.env.DATABASE_URL = 'postgresql://dummy:dummy@localhost:5432/dummy';
process.env.RATE_LIMIT_MAX = '3';

const { app } = await import('../server');
const request = (await import('supertest')).default;

describe('Rate limiting on database routes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 429 after exceeding rate limit on POST /api/db/users', async () => {
    // Rate limit is 3 per minute. Send 3 requests (should pass), then 1 more (should be 429).
    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .post('/api/db/users')
        .send({ id: 'u1', email: 'a@b.com', name: 'Test' });
      expect(res.status).not.toBe(429);
    }
    const res = await request(app)
      .post('/api/db/users')
      .send({ id: 'u1', email: 'a@b.com', name: 'Test' });
    expect(res.status).toBe(429);
  });

  it('returns 429 after exceeding rate limit on POST /api/db/social-connections', async () => {
    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .post('/api/db/social-connections')
        .send({ userId: 'u1', provider: 'instagram', providerId: 'p1' });
      expect(res.status).not.toBe(429);
    }
    const res = await request(app)
      .post('/api/db/social-connections')
      .send({ userId: 'u1', provider: 'instagram', providerId: 'p1' });
    expect(res.status).toBe(429);
  });

  it('returns 429 with error message after exceeding rate limit on GET /api/db/social-connections', async () => {
    for (let i = 0; i < 3; i++) {
      const res = await request(app).get('/api/db/social-connections/u1/instagram');
      expect(res.status).not.toBe(429);
    }
    const res = await request(app).get('/api/db/social-connections/u1/instagram');
    expect(res.status).toBe(429);
    expect(res.body).toHaveProperty('error', 'too_many_requests');
  });

  it('health endpoint is not rate-limited', async () => {
    // Health endpoint should always return 200 even after many requests.
    for (let i = 0; i < 10; i++) {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
    }
  });
});
