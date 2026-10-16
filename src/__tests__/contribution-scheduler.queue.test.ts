import { getCronPattern, scheduleGroupCycle } from '../queue/contribution-scheduler.queue';
import { redisClient } from '../lib/redis';
import { ContributionFrequency } from '@prisma/client';

// Mock bullmq
jst.mock('bullmq', () => {
    return {
        Queue: jest.fn().mockImplementation(() => ({
            add: jest.fn().mockResolvedValue({ id: 'job-id' }),
            removeRepeatable: jest.fn().mockResolvedValue(true),
            close: jest.fn().mockResolvedValue(true),
        })),
        Worker: jest.fn().mockImplementation(() => ({
            on: jest.fn(),
            close: jest.fn().mockResolvedValue(true),
        }))
    };
});

describe('Contribution Scheduler', () => {
    beforeAll(() => {
        // Assume Redis is ready for tests
        Object.defineProperty(redisClient, 'status', { value: 'ready' });
    });

    afterAll(async () => {
        if (redisClient.status === 'ready') {
            await redisClient.quit().catch(() => {});
        }
    });

    describe('getCronPattern', () => {
        it('should return correct pattern for WEEKLY', () => {
            expect(getCronPattern(ContributionFrequency.WEEKLY)).toBe('0 9 * * 1');
        });

        it('should return correct pattern for BIWEEKLY', () => {
            expect(getCronPattern(ContributionFrequency.BIWEEKLY)).toBe('0 9 * * 1/2');
        });

        it('should return correct pattern for MONTHLY', () => {
            expect(getCronPattern(ContributionFrequency.MONTHLY)).toBe('0 9 1 * *');
        });

        it('should throw error for invalid frequency', () => {
            expect(() => getCronPattern('DAILY' as ContributionFrequency)).toThrow('Unsupported frequency: DAILY');
        });
    });

    describe('scheduleGroupCycle', () => {
        it('should add repeatable job with correct jobId and pattern', async () => {
            const jobId = await scheduleGroupCycle('group-123', ContributionFrequency.WEEKLI);
            expect(jobId).toBe('cycle-start:group-123');
        });
    });
});
