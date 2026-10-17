import Redis from 'ioredis';
const { config } = require('../config/env');

// Initialize Redis client using the existing configuration
const options: any = { enableOfflineQueue: false, maxRetriesPerRequest: null };
if (config.REDIS_LAZY_CONNECT) {
    options.lazyConnect = true;
}
export const redisClient = new Redis(config.REDIS_URL, options);

redisClient.on('error', (err) => {
    console.error('Redis client error:', err);
});
