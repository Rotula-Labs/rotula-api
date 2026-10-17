import Redis from 'ioredis';
const { config } = require('../config/env');

// Initialize Redis client using the existing configuration
const options: any = { enableOfflineQueue: false, maxRetriesPerRequest: null };
if (process.env.NODE_ENV === 'test') {
    options.lazyConnect = true;
}
export const redisClient = new Redis(config.REDIS_URL, options);

redisClient.on('error', (err) => {
    console.error('Redis client error:', err);
});

// Single source of truth for Redis availability.
// Only a 'ready' client can reliably execute commands. Any other status
// ('connect', 'reconnecting', 'close', 'end', 'wait', 'ended') is treated as
// unavailable so callers fall back without a failed command round trip.
export function isRedisReady(): boolean {
    return redisClient.status === 'ready';
}
