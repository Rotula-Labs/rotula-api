import Redis from 'ioredis';
const { config } = require('../config/env');

// Initialize Redis client using the existing configuration
const options: any = { enableOfflineQueue: false, maxRetriesPerRequest: null };
if (process.env.NODE_ENV === 'test') {
    options.lazyConnect = true;
}
export const redisClient = new Redis(config.REDIS_URL, options);

redisClient.on('error', (err) => {
    logError('Redis client error', err, { client: 'redis' });
});
