import request from 'supertest';
import express from 'express';
import crypto from 'crypto';
import { config } from '../config/env';

jest.mock('../lib/redis', () => ({
    redisClient: {
        set: jest.fn(),
        get: jest.fn(),
    },
}));

jest.mock('../queue/message.queue', () => ({
    enqueueMessage: jest.fn().mockResolvedValue({ id: 'mock-job-id' }),
}));

const mockCommandRateLimit = jest.fn((req: any, res: any, next: any) => next());

jest.mock('../middleware/command-rate-limit.middleware', () => ({
    commandRateLimitMiddleware: (req: any, res: any, next: any) => mockCommandRateLimit(req, res, next),
}));

jest.mock('../middleware/webhook-signature.middleware', () => ({
    webhookSignatureMiddleware: (req: any, res: any, next: any) => {
        const { config } = require('../config/env');
        const crypto = require('crypto');
        const signature = req.headers['x-hub-signature-256'];
        if (!signature) {
            return res.status(403).json({ error: 'Missing signature' });
        }
        const rawBody = req.rawBody ? req.rawBody.toString('utf8') : '';
        const expected = 'sha256=' + crypto.createHmac('sha256', config.WHATSAPP_APP_SECRET).update(rawBody, 'utf8').digest('hex');
        const sigBuf = Buffer.from(signature);
        const expBuf = Buffer.from(expected);
        if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
            return res.status(403).json({ error: 'Invalid signature' });
        }
        let parsed: any;
        try {
            parsed = JSON.parse(rawBody);
        } catch {
            return res.status(400).json({ error: 'Invalid JSON' });
        }
        const msg = parsed?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
        if (msg?.timestamp) {
            const ts = parseInt(msg.timestamp, 10);
            const now = Math.floor(Date.now() / 1000);
            if (now - ts > 300) {
                return res.status(403).json({ error: 'Stale webhook' });
            }
        }
        if (msg?.id) {
            const { redisClient } = require('../lib/redis');
            redisClient.set(`webhook:msg:${msg.id}`, '1', 'EX', 300, 'NX').then((result: any) => {
                if (result === null) {
                    return res.status(403).json({ error: 'Duplicate webhook' });
                }
                return next();
            }).catch(() => next());
            return;
        }
        return next();
    },
}));

jest.mock('../services/observability.service', () => ({
    observabilityService: { logInfo: jest.fn(), logError: jest.fn(), alertCriticalFailure: jest.fn() },
}));

const { redisClient } = require('../lib/redis');
const mockRedisSet = redisClient.set as jest.Mock;

import botRoutes from '../routes/bot.routes';

const app = express();

app.use(express.json({
    verify: (req: any, res, buf) => {
        req.rawBody = buf;
    },
}));

app.use('/api', botRoutes);

function validPayload(overrides?: { timestamp?: number; messageId?: string }) {
    const ts = overrides?.timestamp ?? Math.floor(Date.now() / 1000);
    const msgId = overrides?.messageId ?? 'wamid.integration.test';
    return {
        object: 'whatsapp_business_account',
        entry: [{
            id: 'phone_number_id',
            changes: [{
                value: {
                    messaging_product: 'whatsapp',
                    metadata: { display_phone_number: '15551234567', phone_number_id: '123456' },
                    contacts: [{ profile: { name: 'Test User' }, wa_id: '12345' }],
                    messages: [{
                        from: '12345',
                        id: msgId,
                        timestamp: String(ts),
                        text: { body: 'SEND 10 @jane' },
                    }],
                },
            }],
        }],
    };
}

function sign(payload: object, secret: string): string {
    const rawBodyString = JSON.stringify(payload);
    const hash = crypto.createHmac('sha256', secret).update(rawBodyString, 'utf8').digest('hex');
    return `sha256=${hash}`;
}

describe('Webhook Integration', () => {
    const testSecret = 'integration_secret';
    let originalSecret: string;

    beforeAll(() => {
        originalSecret = config.WHATSAPP_APP_SECRET;
        config.WHATSAPP_APP_SECRET = testSecret;
    });

    afterAll(() => {
        config.WHATSAPP_APP_SECRET = originalSecret;
    });

    beforeEach(() => {
        jest.clearAllMocks();
        mockRedisSet.mockResolvedValue('OK');
    });

    it('should reject requests without a signature', async () => {
        const payload = { object: 'whatsapp_business_account' };

        const response = await request(app)
            .post('/api/webhook')
            .send(payload);

        expect(response.status).toBe(403);
        expect(response.body.error).toBe('Missing signature');
    });

    it('should run the signature middleware before the command rate limiter', async () => {
        const payload = { object: 'whatsapp_business_account' };

        const response = await request(app)
            .post('/api/webhook')
            .send(payload);

        expect(response.status).toBe(403);
        expect(mockCommandRateLimit).not.toHaveBeenCalled();
    });

    it('should run the command rate limiter for a legitimately signed request', async () => {
        const payload = validPayload();
        const signature = sign(payload, testSecret);

        const response = await request(app)
            .post('/api/webhook')
            .set('x-hub-signature-256', signature)
            .set('Content-Type', 'application/json')
            .send(JSON.stringify(payload));

        expect(response.status).toBe(200);
        expect(mockCommandRateLimit).toHaveBeenCalled();
    });

    it('should reject requests with an invalid signature', async () => {
        const payload = { object: 'whatsapp_business_account' };
        const rawBodyString = JSON.stringify(payload);
        const wrongHash = crypto.createHmac('sha256', 'wrong_secret').update(rawBodyString, 'utf8').digest('hex');

        const response = await request(app)
            .post('/api/webhook')
            .set('x-hub-signature-256', `sha256=${wrongHash}`)
            .set('Content-Type', 'application/json')
            .send(rawBodyString);

        expect(response.status).toBe(403);
        expect(response.body.error).toBe('Invalid signature');
    });

    it('should accept requests with a valid signature', async () => {
        const payload = validPayload();
        const signature = sign(payload, testSecret);

        const response = await request(app)
            .post('/api/webhook')
            .set('x-hub-signature-256', signature)
            .set('Content-Type', 'application/json')
            .send(JSON.stringify(payload));

        if (response.status !== 200) {
            console.log('Webhook integration failure response:', response.body);
        }
        expect(response.status).toBe(200);
    });

    it('should reject a forged signature', async () => {
        const payload = validPayload();

        const response = await request(app)
            .post('/api/webhook')
            .set('x-hub-signature-256', 'sha256=0000000000000000000000000000000000000000000000000000000000000000')
            .set('Content-Type', 'application/json')
            .send(JSON.stringify(payload));

        expect(response.status).toBe(403);
        expect(response.body.error).toBe('Invalid signature');
    });

    it('should reject a stale webhook with timestamp older than 5 minutes', async () => {
        const staleTimestamp = Math.floor(Date.now() / 1000) - 301;
        const payload = validPayload({ timestamp: staleTimestamp });
        const signature = sign(payload, testSecret);

        const response = await request(app)
            .post('/api/webhook')
            .set('x-hub-signature-256', signature)
            .set('Content-Type', 'application/json')
            .send(JSON.stringify(payload));

        expect(response.status).toBe(403);
        expect(response.body.error).toBe('Stale webhook');
    });

    it('should reject a duplicate webhook (replay attack)', async () => {
        mockRedisSet.mockResolvedValue(null);

        const payload = validPayload({ messageId: 'wamid.replay.test' });
        const signature = sign(payload, testSecret);

        const response = await request(app)
            .post('/api/webhook')
            .set('x-hub-signature-256', signature)
            .set('Content-Type', 'application/json')
            .send(JSON.stringify(payload));

        expect(response.status).toBe(403);
        expect(response.body.error).toBe('Duplicate webhook');
    });
});
