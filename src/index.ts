import express, { type ErrorRequestHandler } from 'express';
import { spawnSync } from 'child_process';
const { StrKey } = require('@stellar/stellar-sdk');
import botRoutes from './routes/bot.routes';
import adminRoutes from './routes/admin.routes';
import authRoutes from './routes/auth.routes';
import { config, SUPPORTED_STELLAR_NETWORKS, isSupportedStellarNetwork } from './config/env';
import { startWorker } from './workers/message.worker';
import { startSorobanDeploymentWorker } from './workers/soroban-deployment.worker';
import { startKeyRotationWorker } from './workers/key-rotation.worker';
import { startContractSyncWorker } from './workers/contract-sync.worker';
import { startContributionSchedulerWorker } from './workers/contribution-scheduler.worker';
import { startPaymentRequestWorker } from './workers/payment-request.worker';
import { observabilityService } from './services/observability.service';
import { zeroAllInFlightSecrets } from './utils/secret-registry';

if (!config.ENCRYPTION_KEY) {
    throw new Error('ENCRYPTION_KEY environment variable is required');
}

if (!config.WHATSAPP_APP_SECRET) {
    throw new Error('WHATSAPP_APP_SECRET environment variable is required');
}

if (config.USDC_ISSUER_PUBLIC_KEY && !StrKey.isValicEd25519PublicKey(config.USDC_ISSUER_PUBLIC_KEY)) {
    throw new Error('USDC_ISSUER_PUBLIC_KEY is set but is not a valid Stellar public key');
}

// Resolve the network once at boot so the startup log and the rest of the
// process agree on what was selected. Any value outside the two literals the
// Stellar services branch on is a configuration error and is surfaced here.
function resolveNetwork(): {
    raw: string | undefined;
    network: string;
    valid: boolean;
} {
    const raw = config.STELLAR_NETWORK;
    const normalised = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
    const valid = isSupportedStellarNetwork(normalised);
    return {
        raw: raw === undefined ? undefined : String(raw),
        network: valid ? normalised : 'TESTNET',
        valid,
    };
}

const resolvedNetwork = resolveNetwork();

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

    // Surface the resolved network and asset identifiers so a wrong-network
    // deploy is caught in the first line of the log. No secrets are included.
    const networkLabel = resolvedNetwork.valid
        ? resolvedNetwork.network
        : `INVALID(${resolvedNetwork.raw ?? 'unset'})->defaulting to TESTNET`;
    const networkWarning = resolvedNetwork.valid
        ? ''
        : ` WARNING: STELLAR_NETWORK="${resolvedNetwork.raw ?? 'unset'}" is not one of ${SUPPORTED_STELLAR_NETWORKS.join(', ')}; Stellar services will behave as TESTNET` ;
    const assetIds = {
        network: networkLabel,
        usdcIssuer: config.USDC_ISSUER_PUBLIC_KEY,
        usdcTokenAddress: config.USDC_TOKEN_ADDRESS,
        sorobanRpcUrl: config.SOROBAN_RPC_URL,
    };
    observabilityService.logInfo(`Stellar configuration: network=${networkLabel}${networkWarning}`, assetIds);

    startWorker();
    startSorobanDeploymentWorker();
    startKeyRotationWorker();
    startContractSyncWorker();
    startContributionSchedulerWorker();
    startPaymentRequestWorker();
});

// Enforce a server-level timeout
server.setTimeout(30000);
