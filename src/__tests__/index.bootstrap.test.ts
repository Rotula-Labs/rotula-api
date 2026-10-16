
jest.mock('express', () => {
    const app = {
        use: jest.fn(),
        get: jest.fn(),
        listen: jest.fn(() => ({ setTimeout: jest.fn() })),
    };
    const express = jest.fn(() => app);
    (express as any).json = jest.fn(() => {
        const parser: any = jest.fn();
        parser.__isJsonParser = true;
        return parser;
    });
    (express as any).static = jest.fn();
    return { __esModule: true, default: express, __app: app };
});

jest.mock('child_process', () => ({
    spawnSync: jest.fn(() => ({ stdout: '0' })),
}));

jest.mock('@stellar/stellar-sdk', () => ({
    StrKey: { isValidEd25519PublicKey: jest.fn(() => true) },
}));

jest.mock('../config/env', () => ({
    config: {
        PORT: 3000,
        ENCRYPTION_KEY: 'test-encryption-key',
        WHATSAPP_APP_SECRET: 'test-app-secret',
        USDC_ISSUER_PUBLIC_KEY: '',
    },
}));

jest.mock('../routes/bot.routes', () => ({}));
jest.mock('../routes/admin.routes', () => ({}));
jest.mock('../routes/auth.routes', () => ({}));
jest.mock('../routes/webhook.routes', () => ({}));
jest.mock('../routes/health.routes', () => ({}));
jest.mock('../routes/probe.routes', () => ({}));
jest.mock('../routes/key-rotation.routes', () => ({}));
jest.mock('../routes/contribution.routes', () => ({}));
jest.mock('../routes/payment-request.routes', () => ({}));

jest.mock('../services/observability.service', () => ({
    observabilityService: {
        logInfo: jest.fn(),
        logWarning: jest.fn(),
        logError: jest.fn(),
        alertCriticalFailure: jest.fn().mockResolvedValue(undefined),
    },
}));

jest.mock('../utils/secret-registry', () => ({
    zeroAllInFlightSecrets: jest.fn(),
}));

jest.mock('../workers/message.worker', () => ({ startWorker: jest.fn() }));
jest.mock('../workers/soroban-deployment.worker', () => ({ startSorobanDeploymentWorker: jest.fn() }));
jest.mock('../workers/key-rotation.worker', () => ({ startKeyRotationWorker: jest.fn() }));
jest.mock('../workers/contract-sync.worker', () => ({ startContractSyncWorker: jest.fn() }));
jest.mock('../workers/contribution-scheduler.worker', () => ({ startContributionSchedulerWorker: jest.fn() }));
jest.mock('../workers/payment-request.worker', () => ({ startPaymentRequestWorker: jest.fn() }));

// Importing the entry point registers the app.listen callback and the process
// safety-net handlers; nothing else runs until the callback fires.
require('../index');

const app = jest.requireMock('express').__app;
const { startWorker } = jest.requireMock('../workers/message.worker');
const { startSorobanDeploymentWorker } = jest.requireMock('../workers/soroban-deployment.worker');
const { startKeyRotationWorker } = jest.requireMock('../workers/key-rotation.worker');
const { startContractSyncWorker } = jest.requireMock('../workers/contract-sync.worker');
const { startContributionSchedulerWorker } = jest.requireMock('../workers/contribution-scheduler.worker');
const { startPaymentRequestWorker } = jest.requireMock('../workers/payment-request.worker');

describe('server bootstrap', () => {
    it('starts every worker, including the contribution-scheduler and payment-request workers, when the server listens', () => {
        expect(app.listen).toHaveBeenCalledTimes(1);

        const onListen = app.listen.mock.calls[0][1];
        expect(typeof onListen).toBe('function');

        onListen();

        expect(startWorker).toHaveBeenCalledTimes(1);
        expect(startSorobanDeploymentWorker).toHaveBeenCalledTimes(1);
        expect(startKeyRotationWorker).toHaveBeenCalledTimes(1);
        expect(startContractSyncWorker).toHaveBeenCalledTimes(1);
        expect(startContributionSchedulerWorker).toHaveBeenCalledTimes(1);
        expect(startPaymentRequestWorker).toHaveBeenCalledTimes(1);
    });

    it('mounts every expected route prefix on the real app', () => {
        const mountedPaths = app.use.mock.calls
            .map((call: any[]) => call[0])
            .filter((arg: unknown): arg is string => typeof arg === 'string');

        expect(mountedPaths).toEqual(
            expect.arrayContaining([
                '/api/webhook',
                '/auth/challenge',
                '/auth/token',
                '/admin/key-rotation/status',
            ]),
        );
    });

    it('registers the JSON body parser before the webhook route', () => {
        const jsonParserIndex = app.use.mock.calls.findIndex(
            (call: any[]) => call[0] && call[0].__isJsonParser === true,
        );
        const webhookIndex = app.use.mock.calls.findIndex(
            (call: any[]) => call[0] === '/api/webhook',
        );

        expect(jsonParserIndex).toBeGreaterThanOrEqual(0);
        expect(webhookIndex).toBeGreaterThanOrEqual(0);
        expect(jsonParserIndex).toBeLessThan(webhookIndex);
    });

    it('registers a JSON 404 handler for unknown paths', () => {
        const notFoundHandler = app.use.mock.calls
            .map((call: any[]) => call[call.length - 1])
            .find((handler: any) => typeof handler === 'function' && handler.length === 2);

        expect(notFoundHandler).toBeDefined();

        const req = {} as any;
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as any;
        notFoundHandler(req, res);

        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
    });
});
