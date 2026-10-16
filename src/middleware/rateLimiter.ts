import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';import { redisClient } from '../lib/redis';

export const customKeyGenerator = (req: any): string => {
    // Attempt to extract the WhatsApp sender's phone number
    const body = req.body;
    if (
        body?.object &&
        body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from
    ) {
        return body.entry[0].changes[0].value[0].messages[0].from;
    }

    // Fallback to IP address (e.g., for webhook verification GET requests)
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    return ip !== 'unknown' ? ipKeyGenerator(ip) : ip;
};

/**
 * Key generator for the auth routes. Keys on the client address (IP),
 * which is the address resolved by the trust-proxy configuration.
 */
export const authIpKeyGenerator = (req: any): string => {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    return ip !== 'unknown' ? ipKeyGenerator(ip) : ip;
};

/**
 * Per-account key generator for the /challenge endpoint. Combines the
 * client address with the requested account so one account cannot be
 * spammed with outstanding challenges.
 */
export const challengeAccountKeyGenerator = (req: any): string => {
    const account = req.query?.account;
    if (typeof account === 'string' && account.length > 0) {
        return `account:${account}`;
    }
    return authIpKeyGenerator(req);
};

const rateLimitHandler = (req: any, res: any, next: any, options: any) => {
    const retryAfter = Math.ceil((options.windowMs ?? 60000) / 1000);
    res.setHeader('Retry-After', String(retryAfter));
    res.status(options.statusCode).json({
        error: 'Too\ many requests, please try again later.',
    });
};

export const webhookRateLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    limit: 100, // Limit each key to 100 requests per window
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `XRate-Limit-*` headers

    // Redis store configuration
    store: new RedisStore({
        // @ts-expect-error - rate-limit-redis types might not perfectly align with ioredis call signature
        sendCommand: (...args: string[]) => redisClient.call(...args),
    }),

    // Custom key generator
    keyGenerator: customKeyGenerator,

    // Custom handler for 429 response
    handler: rateLimitHandler,
});

/**
 * Rate limit for the SEP-10 /challenge endpoint. Keyed on the client
 * address so a single caller cannot use the server as a free signing service.
 */
export const challengeRateLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    limit: 30, // Limit each client to 30 challenges per window
    standardHeaders: true,
    legacyHeaders: false,

    store: new RedisStore({
        // @ts-expect-error - rate-limit-redis types might not perfectly align with ioredis call signature
        sendCommand: (...args: string[]) => redisClient.call(...args),
    }),

    keyGenerator: authIpKeyGenerator,

    handler: rateLimitHandler,
});

/**
 * Per-account rate limit for the SEP-10 /challenge endpoint. Prevents a
 * single account from being spammed with outstanding challenges.
 */
export const challengeAccountRateLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    limit: 10, // Limit each account to 10 challenges per window
    standardHeaders: true,
    legacyHeaders: false,

    store: new RedisStore({
        // @ts-expect-error - rate-limit-redis types might not perfectly align with ioredis call signature
        sendCommand: (...args: string[]) => redisClient.call(...args),
    }),

    keyGenerator: challengeAccountKeyGenerator,

    handler: rateLimitHandler,
});

/**
 * Rate limit for the SEP-10 /token endpoint. Keyed on the client address
 * so failed verifications cannot be used to fill Redis.
 */
export const tokenRateLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    limit: 30, // Limit each client to 30 token requests per window
    standardHeaders: true,
    legacyHeaders: false,

    store: new RedisStore({
        // @ts-expect-error - rate-limit-redis types might not perfectly align with ioredis call signature
        sendCommand: (...args: string[]) => redisClient.call(...args),
    }),

    keyGenerator: authIpKeyGenerator,

    handler: rateLimitHandler,
});
