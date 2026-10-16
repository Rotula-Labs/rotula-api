jest.mock('../lib/redis', () => ({
    redisClient: {
        status: 'ready',
        scan: jest.fn(),
        del: jest.fn(),
        get: jest.fn(),
        set: jest.fn(),
    },
}));

const mockWorkerInstance = {
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
};

const mockWorkerConstructor = jest.fn().mockImplementation(() => mockWorkerInstance);

jest.mock('bullmq', () => ({
    Queue: jest.fn().mockImplementation(() => ({
        add: jest.fn().mockResolvedValue({ id: 'job-1' }),
        close: jest.fn().mockResolvedValue(undefined),
    })),
    Worker: mockWorkerConstructor,
}));

// savingsGroup mocks are assigned here so they are accessible from test bodies
const mockFindMany = jest.fn();
const mockUpdate = jest.fn();
const mockFindUnique = jest.fn();

jest.mock('@prisma/client', () => ({
    PrismaClient: jest.fn().mockImplementation(() => ({
        savingsGroup: {
            findMany: (...args: any[]) => mockFindMany(...args),
            update: (...args: any[]) => mockUpdate(...args),
            findUnique: (...args: any[]) => mockFindUnique(...args),
        },
    })),
}));

const mockDeployGroupContract = jest.fn();

jest.mock('../services/soroban-deploy', () => ({
    deployGroupContract: (...args: any[]) => mockDeployGroupContract(...args),
}));

import { enqueueContractDeployment, getFailedDeployments, retryFailedDeployment } from '../queue/soroban-deployment.queue';
import { startSorobanDeploymentWorker } from '../workers/soroban-deployment.worker';

describe('Soroban Deployment Queue & DLQ Unit Tests', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('enqueueContractDeployment should add job to queue', async () => {
        const job = await enqueueContractDeployment('group-123');
        expect(job).toBeDefined();
    });

    it('getFailedDeployments should query Prisma for FAILED status groups', async () => {
        mockFindMany.mockResolvedValue([
            { id: 'group-failed', name: 'Failed Group', deploymentStatus: 'FAILED', deploymentError: 'Timeout' },
        ]);

        const failed = await getFailedDeployments();
        expect(failed).toHaveLength(1);
        expect(failed[0].id).toBe('group-failed');
        expect(mockFindMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: { deploymentStatus: 'FAILED' } })
        );
    });

    it('retryFailedDeployment should reset deploymentStatus to PENDING and enqueue job', async () => {
        mockUpdate.mockResolvedValue({
            id: 'group-failed',
            deploymentStatus: 'PENDING',
            deploymentError: null,
        });

        const job = await retryFailedDeployment('group-failed');
        expect(mockUpdate).toHaveBeenCalledWith({
            where: { id: 'group-failed' },
            data: {
                deploymentStatus: 'PENDING',
                deploymentError: null,
            },
        });
        expect(job).toBeDefined();
    });
});

describe('Soroban Deployment Worker Handler', () => {
    let processor: (job: any) => Promise<void>;

    beforeEach(() => {
        jest.clearAllMocks();
        mockWorkerConstructor.mockClear();
        startSorobanDeploymentWorker();
        const calls = mockWorkerConstructor.mock.calls;
        const lastCall = calls[calls.length - 1];
        processor = lastCall[1] as (job: any) => Promise<void>;
    });

    it('throws when the group does not exist', async () => {
        mockFindUnique.mockResolvedValue(null);

        await expect(processor({ data: { groupId: 'missing-group' } })).rejects.toThrow('Group not found');
        expect(mockUpdate).not.toHaveBeenCalled();
        expect(mockDeployGroupContract).not.toHaveBeenCalled();
    });

    it('uses adminPublicKey undefined when the creator wallet is not valid JSON', async () => {
        mockFindUnique.mockResolvedValue({
            id: 'group-1',
            name: 'Group 1',
            creator: { wallet: 'not-valid-json' },
        });
        mockUpdate.mockResolvedValue({});
        mockDeployGroupContract.mockResolved({ contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' });

        await processor({ data: { groupId: 'group-1' } });

        expect(mockDeployGroupContract).toHaveBeenCalled(
            'group-1',
            'Group 1',
            undefined
        );
    });

    it('sets DEPLOYING before deploying and persists DEPLOYED with the contract id on success', async () => {
        mockFindUnique.mockResolvedValue({
            id: 'group-1',
            name: 'Group 1',
            creator: { wallet: JSON.stringify({ adminPublicKey: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }) },
        });
        mockUpdate.mockResolvedValue({});
        mockDeployGroupContract.mockResolved({ contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' });

        await processor({ data: { groupId: 'group-1' } });

        expect(mockUpdate).toHaveBeenCalledWith({
            where: { id: 'group-1' },
            data: { deploymentStatus: 'DEPLOYING' },
        });
        expect(mockUpdate).toHaveBeenCalledWith({
            where: { id: 'group-1' },
            data: {
                deploymentStatus: 'DEPLOYED',
                stellarContractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
            },
        });
        const deployingCallIndex = mockUpdate.mock.calls.findIndex(
            (call) => call[0]?.data?.deploymentStatus === 'DEPLOYING'
        );
        const deployedCallIndex = mockUpdate.mock.calls.findIndex(
            (call) => call[0]?.data?.deploymentStatus === 'DEPLOYED'
        );
        expect(deployingCallIndex).toBeGreaterThanOrEqual(0);
        expect(deployedCallIndex).toBeGreaterThan(deployingCallIndex);
    });

    it('persists FAILED with the error message and re-throws on failure', async () => {
        mockFindUnique.mockResolvedValue({
            id: 'group-1',
            name: 'Group 1',
            creator: { wallet: JSON.stringify({ adminPublicKey: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }) },
        });
        mockUpdate.mockResolvedValue({});
        mockDeployGroupContract.mockRejected(new Error('deploy failed'));

        await expect(processor({ data: { groupId: 'group-1' } })).rejects.toThrow('deploy failed');

        expect(mockUpdate).toHaveBeenCalledWith({
            where: { id: 'group-1' },
            data: { deploymentStatus: 'DEPLOYING' },
        });
        expect(mockUpdate).toHaveBeenCalledWith({
            where: { id: 'group-1' },
            data: {
                deploymentStatus: 'FAILED',
                deploymentError: 'deploy failed',
            },
        });
    });
});
