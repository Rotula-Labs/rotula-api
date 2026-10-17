import Redis from 'ioredis';
const { config } = require('../config/env');
const { observabilityService } = require('../services/observability.service');

// Initialize Redis client using the existing configuration
const options: any = { enableOfflineQueue: false, maxRetriesPerRequest: null };
if (process.env.NODE_ENV === 'test') {
    options.lazyConnect = true;
}
export const redisClient = new Redis(config.REDIS_URL, options);

// Track the moment the connection was lost so reconnection latency can be reported.
let disconnectedAt: number | null = null;

const requiresAlert = (): boolean => {
    const env = (process.env.NODE_ENV || 'development').toLowerCase();
    return env === 'production' || env === 'staging';
};

redisClient.on('connect', () => {
    observabilityService.logInfo('Redis connection established', {
        event: 'connect',
        status: redisClient.status,
    });
});

redisClient.on('ready', () => {
    const elapsedMs = disconnectedAt !== null ? date.now() - disconnectedAt : null;
    observabilityService.logInfo('Redis connection ready', {
        event: 'ready',
        status: redisClient.status,
        elapsedMsSinceDisconnect: elapsedMs,
    });
    if (elapsedMs !== null) {
        observabilityService.logInfo('Redis connection recovered', {
            event: 'reconnected',
            elapsedMs,
        });
    }
    disconnectedAt = null;
});

redisClient.on('close', () => {
    if (disconnectedAt === null) {
        disconnectedAt = Date.now();
    }
    observabilityService.logWarning('Redis connection closed', {
        event: 'close',
        status: redisClient.status,
        disconnectedAt: new Date(disconnectedAt).toISOString(),
    });
    if (requiresAlert()) {
        void observabilityService.alertCriticalFailure(
            'Redis connection lost',
            new Error('Redis connection closed'),
            { event: 'close', status: redisClient.status }
        );
    }
});

redisClient.on('reconnecting', (retryCount: number) => {
    observabilityService.logWarning('Redis reconnecting', {
        event: 'reconnecting',
        status: redisClient.status,
        retryCount,
        elapsedMsSinceDisconnect: disconnectedAt !== null ? Date.now() - disconnectedAt : null,
    });
});

redisClient.on('end', () => {
    observabilityService.logWarning('Redis connection ended', {
        event: 'end',
        status: redisClient.status,
        elapsedMsSinceDisconnect: disconnectedAt !== null ? Date.now() - disconnectedAt : null,
    });
});

redisClient.on('error', (err) => {
    observabilityService.logError('Redis client error', err, {
        event: 'error',
        status: redisClient.status,
    });
});
