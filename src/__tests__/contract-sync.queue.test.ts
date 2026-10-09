jest.mock('bullmq', () => {
    const mockQueue = {
        getRepeatableJobs: jest.fn(),
        removeRepeatableByKey: jest.fn(),
        add: jest.fn(),
        close: jest.fn(),
    };
    return {
        Queue: jest.fn(() => mockQueue),
        __mockQueue: mockQueue,
    };
});

import { scheduleReconciliation, closeContractSyncQueue } from '../queue/contract-sync.queue';

const { __mockQueue: mockQueue } = jest.requireMock('bullmq');

describe('scheduleReconciliation', () => {
    beforeEach(() => {
        mockQueue.getRepeatableJobs.mockReset().mockResolvedValue([]);
        mockQueue.removeRepeatableByKey.mockReset().mockResolvedValue(true);
        mockQueue.add.mockReset().mockResolvedValue({ id: 'contract-sync:reconcile' });
    });

    afterAll(async () => {
        await closeContractSyncQueue();
    });

    it('registers a single 5-minute reconcile repeatable job', async () => {
        await scheduleReconciliation();

        expect(mockQueue.add).toHaveBeenCalledTimes(1);
        expect(mockQueue.add).toHaveBeenCalledWith(
            'reconcile',
            {},
            {
                repeat: { pattern: '*/5 * * * *' },
                jobId: 'contract-sync:reconcile',
            },
        );
        expect(mockQueue.removeRepeatableByKey).not.toHaveBeenCalled();
    });

    it('removes stale reconcile repeatables and leaves unrelated jobs alone', async () => {
        mockQueue.getRepeatableJobs.mockResolvedValueOnce([
            { name: 'reconcile', key: 'reconcile:stale' },
            { name: 'other-job', key: 'other:keep' },
        ]);

        await scheduleReconciliation();

        expect(mockQueue.removeRepeatableByKey).toHaveBeenCalledTimes(1);
        expect(mockQueue.removeRepeatableByKey).toHaveBeenCalledWith('reconcile:stale');
        expect(mockQueue.add).toHaveBeenCalledTimes(1);
    });

    it('does not leave a duplicate reconcile schedule after a second call', async () => {
        await scheduleReconciliation();

        // On the next call BullMQ reports the previously registered job.
        mockQueue.getRepeatableJobs.mockResolvedValueOnce([
            { name: 'reconcile', key: 'contract-sync:reconcile' },
        ]);

        await scheduleReconciliation();

        expect(mockQueue.removeRepeatableByKey).toHaveBeenCalledWith('contract-sync:reconcile');
        // Both registrations use the same jobId, so BullMQ keeps a single schedule.
        const jobIds = mockQueue.add.mock.calls.map((call: any[]) => call[2].jobId);
        expect(jobIds).toEqual(['contract-sync:reconcile', 'contract-sync:reconcile']);
        expect(new Set(jobIds).size).toBe(1);
    });
});
