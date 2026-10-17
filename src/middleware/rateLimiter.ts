import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
const { redisClient } = require('../lib/redis');

export const customKeyGenerator = (req: any): string => {
    // Attempt to extract the WhatsApp sender's phone number
    const body = req.body;
    if (
        body?.object &&
        body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from
    ) {
        return body.entry[0].changes[0].value.messages[0].from;
    }

    // Fallback to IP address (e.g., for webhook verification GET requests)
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    return ip !== 'unknown' ? ipKeyGenerator(ip) : ip;
};

const MAX_FALLBACK_KEYS = 10000;
const fallbackHits = new Map<string, { hits: number; ts: number }>();

function boundedIncrement(key: string): number {
    const now = Date.now();
    const entry = fallbackHits.get(key);
    if (entry) {
        entry.hits += 1;
        entry.ts = now;
        // refresh LRU order
        fallbackHits.delete(key);
        fallbackHits.set(key, entry);
        return entry.hits;
    }
    fallbackHits.set(key, { hits: 1, ts: now });
    if (fallbackHits.size > MAX_FALLBACK_KEYS) {
        const oldest = fallbackHits.keys().next().value;
        if (oldest !== undefined) fallbackHits.delete(oldest);
    }
    return 1;
}

export const webhookRateLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    limit: 100, // Limit each key to 100 requests per window
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers

    // Redis store configuration
    store: new RedisStore({
        // @ts-expect-error - rate-limit-redis types might not perfectly align with ioredis call signature
        sendCommand: (...args: string[]) => redisClient.call(...args),
    }),

    // Custom key generator
    keyGenerator: customKeyGenerator,

    // Custom handler for 429 response
    handler: (req, res, next, options) => {
        res.status(options.statusCode).json({
            error: 'Too many requests, please try again later.',
        });
    },
});
