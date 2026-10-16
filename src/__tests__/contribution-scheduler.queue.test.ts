import {
    getCronPattern,
    scheduleGroupCycle,
    removeGroupCycle,
    enqueueDelayedReminder,
    enqueueCycleEnd,
} from '../queue/contribution-scheduler.queue';
import { redisClient } from '../lib/redis';

// Mock bullmq
jest.mock('bullmq', () => {
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
        Object.defineProperty(redisClient, 'status', { value: 'ready', configurable: true });
    });

    afterAll(async () => {
        if (redisClient.status === 'ready') {
            await redisClient.quit().catch(() => {});
        }
    });

    describe('getCronPattern', () => {
        it('should return correct pattern for WEEKLY', () => {
            expect(getCronPattern('WEEKLY')).toBe('0 9 * * 1');
        });

        it('should return correct pattern for BIWEEKLY', () => {
            expect(getCronPattern('BIWEEKLY')).toBe('0 9 * * 1/2');
        });

        it('should return correct pattern for MONTHLY', () => {
            expect(getCronPattern('MONTHLY')).toBe('0 9 1 * *');
        });

        it('should throw error for invalid frequency', () => {
            expect(() => getCronPattern('DAILY')).toThrow('Unsupported frequency: DAILY');
        });
    });

    describe('scheduleGroupCycle', () => {
        it('should add repeatable job with correct jobId and pattern', async () => {
            const jobId = await scheduleGroupCycle('group-123', 'WEEKLY');
            expect(jobId).toBe('cycle-start:group-123');
        });
    });

    describe('enqueue and removal helpers', () => {
        const getQueueInstance = () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { Queue } = require('bullmq') as any;
            return Queue.mock.results[Queue.mock.results.length - 1].value;
        };

        const setRedisStatus = (status: string) => {
            Object.defineProperty(redisClient, 'status', { value: status, configurable: true });
        };

        beforeEach(() => {
            jest.clearAllMocks();
            setRedisStatus('ready');
        });

        afterAll(() => {
            setRedisStatus('ready');
        });

        describe('removeGroupCycle', () => {
            it('should remove the repeatable job with the cron pattern and cycle-start jobId', async () => {
                const queue = getQueueInstance();
                await removeGroupCycle('group-123', 'WEEKLY');
                expect(queue.removeRepeatable).toHaveBeenCalledWith(
                    'cycle-start:group-123',
                    getCronPattern('WEEKLY')
                );
            });

            it('should return null and log when Redis is not ready', async () => {
                setRedisStatus('connecting');
                const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
                const result = await removeGroupCycle('group-123', 'WEEKLY');
                expect(result).toBeNull();
                expect(errorSpy).toHaveBeenCalled();
                errorSpy.mockRestore();
            });
        });

        describe('enqueueDelayedReminder', () => {
            it('should add a last-call-reminder job with the reminder jobId prefix', async () => {
                const queue = getQueueInstance();
                await enqueueDelayedReminder('group-123', 5000);
                expect(queue.add).toHaveBeenCalled();
                const [name, data, opts] = queue.add.mock.calls[0];
                expect(name).toBe('last-call-reminder');
                expect(data).toMatchObject({ groupId: 'group-123' });
                expect(opts.delay).toBe(5000);
                expect(opts.jobId).toMatch(/^reminder:group-123:\d+$/);
            });

            it('should clamp a negative delay to 0', async () => {
                const queue = getQueueInstance();
                await enqueueDelayedReminder('group-123', -1000);
                const [, , opts] = queue.add.mock.calls[0];
                expect(opts.delay).toBe(0);
            });

            it('should return null and log when Redis is not ready', async () => {
                setRedisStatus('connecting');
                const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
                const result = await enqueueDelayedReminder('group-123', 5000);
                expect(result).toBeNull();
                expect(errorSpy).toHaveBeenCalled();
                errorSpy.mockRestore();
            });
        });

        describe('enqueueCycleEnd', () => {
            it('should add a cycle-end job with the end jobId prefix', async () => {
                const queue = getQueueInstance();
                await enqueueCycleEnd('group-123', 7500);
                expect(queue.add).toHaveBeenCalled();
                const [name, data, opts] = queue.add.mock.calls[0];
                expect(name).toBe('cycle-end');
                expect(data).toMatchObject({ groupId: 'group-123' });
                expect(opts.delay).toBe(7500);
                expect(opts.jobId).toMatch(/^end:group-123:\d+$/);
            });

            it('should clamp a negative delay to 0', async () => {
                const queue = getQueueInstance();
                await enqueueCycleEnd('group-123', -500);
                const [, , opts] = queue.add.mock.calls[0];
                expect(opts.delay).toBe(0);
            });

            it('should return null and log when Redis is not ready', async () => {
                setRedisStatus('connecting');
                const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
                const result = await enqueueCycleEnd('group-123', 7500);
                expect(result).toBeNull();
                expect(errorSpy).toHaveBeenCalled();
                errorSpy.mockRestore();
            });
        });
    });
});
