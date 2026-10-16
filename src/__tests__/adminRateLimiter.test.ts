import express from 'express';
import request from 'supertest';
import { createAdminRateLimiter } from '../middleware/rateLimiter';

function appWithAdminLimit() {
    const app = express();
    app.set('trust proxy', 1);
    app.use('/admin', createAdminRateLimiter());
    app.get('/admin', (_req, res) => res.status(200).json({ ok: true }));
    return app;
}

describe('admin rate limit', () => {
    it('returns 429 with Retry-After after five requests from one client', async () => {
        const app = appWithAdminLimit();
        for (let i = 0; i < 5; i += 1) {
            await request(app).get('/admin').set('X-Forwarded-For', '198.51.100.10').expect(200);
        }

        const limited = await request(app).get('/admin').set('X-Forwarded-For', '198.51.100.10').expect(429);
        expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    });

    it('keeps a different client address below the limit', async () => {
        const app = appWithAdminLimit();
        for (let i = 0; i < 5; i += 1) {
            await request(app).get('/admin').set('X-Forwarded-For', '198.51.100.11').expect(200);
        }
        await request(app).get('/admin').set('X-Forwarded-For', '198.51.100.12').expect(200);
    });
});
