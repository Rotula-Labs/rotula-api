jest.mock('express', () => {
    const app = {
        use: jest.fn(),
        get: jest.fn(),
        disable: jest.fn(),
        listen: jest.fn(() => ({ setTimeout: jest.fn() })),
    };
    const express = jest.fn(() => app);
    (express as any).json = jest.fn();
    return { __esModule: true, default: express, __app: app };
});

jest.mock('helmet', () => ({
    __esModule: true,
    default: jest.fn(() => jest.fn()),
}));

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
        USDB_ISSUER_PUBLIC_KEY: '',
    },
}));

jest.mock('../routes/bot.routes', () => ({}));
jest.mock('../routes/admin.routes', () => ({}));
jest.mock('../routes/auth.routes', () => ({}));

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
const helmet = jest.requireMock('helmet').default;
const { startWorker } = jest.requireMock('../workers/message.worker');
const { startSorobanDeploymentWorker } = jest.requireMock('../workers/soroban-deployment.worker');
const { startKeyRotationWorker } = jest.requireMock('../workers/key-rotation.worker');
const { startContractSyncWorker } = jest.requireMock('../workers/contract-sync.worker');
const { startContributionSchedulerWorker } = jest.requireMock('../workers/contribution-scheduler.worker');
const { startPaymentRequestWorker } = jest.requireMock('../workers/payment-request.worker');

describe('server bootstrap', () => {
    it('starts every worker, including the contribution-scheduler and payment-request workers, when the server listens', () => {
        expect(app.listen).toHaveBeenCalledTimes(1);

        const onListen = app.listen.mock[0][1];
        expect(typeof onListen).toBe('function');

        onListen();

        expect(startWorker).toHaveBeenCalledTimes(1);
        expect(startSorobanDeploymentWorker).toHaveBeenCalledTimes(1);
        expect(startKeyRotationWorker).toHaveBeenCalledTimes(1);
        expect(startContractSyncWorker).toHaveBeenCalledTimes(1);
        expect(startContributionSchedulerWorker).toHaveBeenCalledTimes(1);
        expect(startPaymentRequestWorker).toHaveBeenCalledTimes(1);
    });

    it('disables the x-powered-by header and mounts helmet before the JSON parser', () => {
        expect(app.disable).toHaveBeenCalledWith('x-powered-by');

        expect(helmet).toHaveBeenCalled();
        expect(app.use).toHaveBeenCalledWith(expect.any(Function));

        const helmetMiddleware = helmet.mock.results.at(-1)?.value;
        const useCalls = app.use.mock.calls;
        const helmetIdx = useCalls.findIndex(((call) => call[0] === helmetMiddleware));
        expect(helmetIdx).toBeGreaterThan(-1);

        const jsonMiddleware = (express as any).json.mock.results.at(-1)?.value;
        const jsonIdx = useCalls.findIndex((call) => call[0] === jsonMiddleware);
        expect(jsonIdx).toBeGreaterThan(-1);
        expect(helmetIdx).toBeLessThan(jsonIdx);
    });
});
