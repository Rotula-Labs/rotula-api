jest.mock('express', () => {
    const app = {
        use: jest.fn(),
        get: jest.fn(),
        listen: jest.fn(() => ({ setTimeout: jest.fn() })),
    };
    const express = jest.fn(() => app);
    (express as any).json = jest.fn(() => jest.fn());
    return { __esModule: true, default: express, __app: app };
});

jest.mock('child_process', () => ({
    spawnSync: jest.fn(() => ({ stdout: '0' })),
}));

jest.mock('@stellar/stellar-sdk', () => ({
    SttKey: { isValidEd25519PublicKey: jest.fn(() => true) },
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

    it('answers a malformed JSON body with 400 and does not alert', () => {
        const { observabilityService } = jest.requireMock('../services/observability.service');
        const parserErrorMiddleware = app.use.mock.calls.find((call) => call.length === 4)?.[0];
        expect(typeof parserErrorMiddleware).toBe('function');

        const err = Object.assign(new Error('Unexpected token in JSON'), {
            type: 'entity.parse.failed',
            status: 400,
            expose: true,
        });
        const res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis(),
        };
        const next = jest.fn();

        parserErrorMiddleware(err, {}, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
        expect(next).not.toHaveBeenCalled();
        expect(observabilityService.alertCriticalFailure).not.toHaveBeenCalled();
    });

    it('answers an oversized body with 413 and does not alert', () => {
        const { observabilityService } = jest.requireMock('../services/observability.service');
        const parserErrorMiddleware = app.use.mock.calls.find((call) => call.length === 4)?.[0];
        expect(typeof parserErrorMiddleware).toBe('function');

        const err = Object.assign(new Error('request entity too large'), {
            type: 'entity.too.large',
            status: 413,
            expose: true,
        });
        const res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis(),
        };
        const next = jest.fn();

        parserErrorMiddleware(err, {}, res, next);

        expect(res.status).toHaveBeenCalledWith(413);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
        expect(next).not.toHaveBeenCalled();
        expect(observabilityService.alertCriticalFailure).not.toHaveBeenCalled();
    });

    it('passes a genuine handler error to the general error handler', () => {
        const parserErrorMiddleware = app.use.mock.calls.find((call) => call.length === 4)?.[0];
        expect(typeof parserErrorMiddleware).toBe('function');

        const err = new Error('boom');
        const res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis(),
        };
        const next = jest.fn();

        parserErrorMiddleware(err, {}, res, next);

        expect(next).toHaveBeenCalledWith(err);
        expect(res.status).not.toHaveBeenCalled();
    });
});
