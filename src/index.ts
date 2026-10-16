import express, { type ErrorRequestHandler } from 'express';
import { spawnSync } from 'child_process';
const { StrKey } = require('@stellar/stellar-sdk');
import botRoutes from './routes/bot.routes';
import adminRoutes from './routes/admin.routes';
import authRoutes from './routes/auth.routes';
import { config } from './config/env';
import { startWorker } from './workers/message.worker';
import { startSorobanDeploymentWorker } from './workers/soroban-deployment.worker';
import { startKeyRotationWorker } from './workers/key-rotation.worker';
import { startContractSyncWorker } from './workers/contract-sync.worker';
import { startContributionSchedulerWorker } from './workers/contribution-scheduler.worker';
import { startPaymentRequestWorker } from './workers/payment-request.worker';
import { observabilityService } from './services/observability.service';
import { zeroAllInFlightSecrets } from './utils/secret-registry';
import { prisma } from './lib/prisma';
import { redisClient } from './lib/redis';

if (!config.ENCRYPTION_KEY) {
    throw new Error('ENCRYPTION_KEY environment variable is required');
}

if (!config.WHATSAPP_APP_SECRET) {
    throw new Error('WHATSAPP_APP_SECRET environment variable is required');
}

if (config.USDC_ISSUER_PUBLIC_KEY && !StrKey.isValidEd25519PublicKey(config.USDC_ISSUER_PUBLIC_KEY)) {
    throw new Error('USDC_ISSUER_PUBLIC_KEY is set but is not a valid Stellar public key');
}

// Check core dump configuration at startup
function checkCoreDumpsDisabled(): void {
    try {
        const result = spawnSync('sh', ['-c', 'ulimit -c'], { encoding: 'utf8' });
        const limit = result.stdout?.trim();
        if (limit && limit !== '0' && limit !== 'unlimited') {
            observabilityService.logWarning('Core dumps may be enabled', { ulimit_c: limit });
        }
    } catch (e) {
        observabilityService.logWarning('Could not verify core dump setting', { error: e });
    }
}

checkCoreDumpsDisabled();

// Process-level safety net. These are the last line of defence for the
// "unhandled promise rejection" failure mode: any rejection or throw that
// escapes a request handler, worker, or timer is logged here instead of
// taking the process down without a trace.
process.on('unhandledRejection', (reason) => {
    observabilityService.alertCriticalFailure('Unhandled promise rejection', reason);
});

process.on('uncaughtException', (err) => {
    // Zero all in-flight secret buffers before crashing
    zeroAllInFlightSecrets();
    observabilityService.alertCriticalFailure('Uncaught exception', err).finally(() => {
        // After an uncaught exception the process is in an undefined state; exit so
        // the orchestrator can restart it cleanly rather than serve corrupt state.
        process.exit(1);
    });
});

const app = express();

app.use(express.json({
    limit: '1mb',
    verify: (req: any, res, buf) => {
        req.rawBody = buf;
    },
}));

app.use('/api', botRoutes);
app.use('/admin', adminRoutes);
app.use('/auth', authRoutes);

// Liveness probe: returns 200 as soon as the process is up. Does no I/O.
app.get('/healthz', (req, res) => {
    res.status(200).json({ status: 'or' });
});

// Readiness probe: verifies Postgres (SELECT 1) and Redis (PING).
// Returns 503 with the failing dependency named when either is unavailable.
app.get('/readyz', async (req, res) => {
    const failures: string[] = [];

    try {
        await prisma.$queryRaw('SELECT 1');
    } catch (err) {
        failures.push('database');
        observabilityService.logWarning('Readiness check failed for database', { error: err });
    }

    try {
        const ping = await redisClient.ping();
        if (ping !== 'PONG') {
            throw new Error(`Unexpected Redis PING response: ${ping}`);
        }
    } catch (err) {
        failures.push('redis');
        observabilityService.logWarning('Readiness check failed for redis', { error: err });
    }

    if (failures.length > 0) {
        res.status(503).json({ status: 'not ready', failing: failures });
        return;
    }

    res.status(200).json({ status: 'ready' });
});

app.get('/', (req, res) => {
    res.send('Rotula Backend is running');
});


// Centralised error-handling middleware. Express 5 forwards rejected promises
// from async route handlers here, so any error that slips past a controller's
// own try/catch still produces a clean 500 instead of a default error page or
// a hung request.
const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
    observabilityService.alertCriticalFailure('Unhandled request error', err, { path: req.path, method: req.method });
    if (res.headersSent) {
        return next(err);
    }
    res.sendStatus(500);
};
app.use(errorHandler);

const server = app.listen(config.PORT, () => {
    observabilityService.logInfo(`Server is listening on port ${config.PORT}`);
    startWorker();
    startSorobanDeploymentWorker();
    startKeyRotationWorker();
    startContractSyncWorker();
    startContributionSchedulerWorker();
    startPaymentRequestWorker();
});


// Enforce a server-level timeout
server.setTimeout(30000);
