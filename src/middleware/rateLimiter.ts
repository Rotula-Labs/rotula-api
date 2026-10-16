import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Request } from 'express';
import RedisStore from 'rate-limit-redis';
import { redisClient } from '../lib/redis';

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

const ADMIN_WINDOW_MS = 15 * 60 * 1000;

/** Strict per-address protection for admin endpoints, including failed auth attempts. */
export function createAdminRateLimiter() {
    return rateLimit({
        windowMs: ADMIN_WINDOW_MS,
        limit: 5,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => ipKeyGenerator(req.ip || req.socket?.remoteAddress || 'unknown'),
        handler: (req, res) => {
            const resetTime = (req as Request & { rateLimit?: { resetTime?: Date } }).rateLimit?.resetTime;
            const retryAfter = resetTime
                ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000))
                : Math.ceil(ADMIN_WINDOW_MS / 1000);
            res.setHeader('Retry-After', String(retryAfter));
            res.status(429).json({ error: 'Too many admin requests. Try again later.' });
        },
    });
}

export const adminRateLimiter = createAdminRateLimiter();
