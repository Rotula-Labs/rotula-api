import Redis, { RedisOptions } from 'ioredis';
const { config } = require('../config/env');

/**
 * Builds the base iORedis options from the shared configuration source.
 * This is the single factory used by both the request-path client and the
 * BullMQ connection options, so the URL and options cannot drift.
 */
function buildRedisOptions(overrides: RedisOptions = {}): RedisOptions {
    const options: RedisOptions = {
        enableOfflineQueue: false,
        maxRetriesPerRequest: null,
        ...overrides,
    };
    if (process.env.NODE_ENV === 'test') {
        options.lazyConnect = true;
    }
    return options;
}

// Request-path client: rate limiting, replay detection, SEP-10 replay
// protection and abuse history. This must not be used by BullMQ because
// blocking commands would starve latency-sensitive calls.
export const redisClient = new Redis(config.REDIS_URL, buildRedisOptions());

redisClient.on('error', (err) => {
    console.error('Redis client error:', err);
});

/**
 * Builds a dedicated iORedis options object for BullMQ queues and workers.
 * BullMQ's blocking commands hold a connection open, so this must be separate
 * from the request-path client. The URL and base options are derived from the
 * same factory as the request-path client.
 */
export function getBullMQRedisOptions(): RedisOptions {
    return {
        url: config.REDIS_URL,
        ...buildRedisOptions(),
    };
}
