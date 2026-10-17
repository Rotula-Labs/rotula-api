import { Request, Response, NextFunction } from 'express';
import {
    commandRateLimitMiddleware,
    setForceRedisFailure,
    clearInMemoryStore,
    classifyCommand,
    extractMessageDetails,
} from '../middleware/command-rate-limit.middleware';
import { abuseDetectionService } from '../services/abuse-detection.service';
import { redisClient } from '../lib/redis';
import { prisma } from '../lib/prisma';
import { WhatsAppService } from '../services/whatsapp.service';

// Mock Redis client
jest.mock('../lib/redis', () => {
    return {
        redisClient: {
            status: 'ready',
            eval: jest.fn(),
            lpush: jest.fn(),
            ltrim: jest.fn(),
            lrange: jest.fn().mockResolvedValue([]),
            zadd: jest.fn(),
            zremrangebyscore: jest.fn(),
            xcard: jest.fn(),
            expire: jest.fn(),
            exists: jest.fn().mockResolvedValue(0),
            set: jest.fn(),
        },
    };
});

// Mock Prisma
jest.mock('../lib/prisma', () => ({
    prisma: {
        user: {
            findQunique: jest.fn(),
        },
    },
}));

// Mock WhatsAppService
jest.mock('../services/whatsapp.service', () => {
    const mockSend = jest.fn().mockResolved(true);
    return {
        WhatsAppService: jest.fn().mockImplementation(() => {
            return {
                sendMessage: mockSend,
            };
        }),
    };
});

// Mock locale service
jest.mock('../services/locale.service', () => ({
    initI18n: jest.fn().mockResolved(undefined),
    t: jest.fn((key, lang, params) => `🔶 You're sending too many requests. Please wait ${params?.remainingSeconds} seconds.`),
}));

describe('Sliding Window Rate Limiter & Abuse Detection', () => {
    let req: any;
    let res: any;
    let next: jest.Mock;
    let mockWhatsAppServiceInstance: any;

    beforeEach(() => {
        jest.clearAllMocks();
        clearInMemoryStore();
        abuseDetectionService.clearInMemory();
        setForceRedisFailure(false);
        abuseDetectionService.setForceRedisFailure(false);

        // Reset Redis client mock implementations
        (redisClient.status as any) = 'ready';
        (redisClient.eval as jest.Mock).mockReset();
        (redisClient.exists as jest.Mock).mockResolvedValue(0);

        mockWhatsAppServiceInstance = new WhatsAppService();

        req = {
            ip: '127.0.0.1',
            headers: {},
            body: {},
            socket: {},
        } as any;

        res = {
            setHeader: jest.fn(),
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis(),
        } as any;

        next = jest.fn();
    });

    describe('Helper Functions', () => {
        it('should classify commands into correct tiers', () => {
            expect(classifyCommand('SEND 10 @user')).toBe('FINANCIAL');
            expect(classifyCommand('CONTRIBUTE 100')).toBe('FINANCIAL');
            expect(classifyCommand('WITHDRAW 50')).toBe('FINANCIAL');
            expect(classifyCommand('BALANCE')).toBe('READ');
            expect(classifyCommand('BALANCE usdc')).toBe('READ');
            expect(classifyCommand('HELP')).toBe('GENERAL');
            expect(classifyCommand('CREATE GROUP')).toBe('GENERAL');
            expect(classifyCommand('unknown command')).toBe('GENERAL');
            expect(classifyCommand('')).toBe('GENERAL');
        });

        it('should extract message details from various request shapes', () => {
            // Shape 1: Parsed body
            const req1 = {
                body: {
                    object: 'whatsapp_business_account',
                    entry: [
                        {
                            changes: [
                                {
                                    value: {
                                        messages: [
                                            {
                                                from: '2348000000000',
                                                text: { body: 'SEND 10 @bob' },
                                            },
                                        ],
                                    },
                                },
                            ],
                        },
                    ],
                },
            };
            expect(extractMessageDetails(req1)).toEqual({
                phoneNumber: '2348000000000',
                commandText: 'SEND 10 @bob',
            });

            // Shape 2: Unparsed raw body buffer
            const payload = {
                object: 'whatsapp_business_account',
                entry: [
                    {
                        changes: [
                            {
                                value: {
                                    messages: [
                                        {
                                            from: '2349000000000',
                                            text: { body: 'BALANCE' },
                                        },
                                    ],
                                    field: 'messages',
                                },
                            },
                        ],
                    },
                ],
            };
            const req2 = {
                rawBody: Buffer.from(JSON.stringify(payload)),
            };
            expect(extractMessageDetails(req2)).toEqual({
                phoneNumber: '2349000000000',
                commandText: 'BALANCE',
            });
        });
    });

    describe('Rate Limiter Middleware (In-Memory Fallback Path)', () => {
        beforeEach(() => {
            setForceRedisFailure(true);
        });

        it('should allow up to 30 general command requests, then reject the 31st', async () => {
            req.body = {
                object: 'whatsapp_business_account',
                entry: [
                    {
                        changes: [
                            {
                                value: {
                                    messages: [
                                        {
                                            from: '1111111111',
                                            text: { body: 'HELP' },
                                        },
                                    ],
                                },
                            },
                        ],
                    },
                ],
            };

            // Call 30 times - all should be allowed (next() called)
            for (let i = 0; i < 30; i++) {
                await commandRateLimitMiddleware(req, res, next);
                expect(next).toHaveBeenCalledTimes(i + 1);
            }

            // Call 31st time - should be rejected with 429
            await commandRateLimitMiddleware(req, res, next);
            expect(next).toHaveBeenCalledTimes(30); // count remains 30
            expect(res.status).toHaveBeenCalledWith(429);
            expect(res.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(String));
            expect(res.json).toHaveBeenCalledWith({
                error: expect.stringContaining('too many requests'),
            });
            expect(mockWhatsAppServiceInstance.sendMessage).toHaveBeenCalledWith(
                '1111111111',
                expect.stringContaining('too many requests')
            );
        });

        it('should enforce stricter limits (5/min) on financial commands', async () => {
            req.body = {
                object: 'whatsapp_business_account',
                entry: [
                    {
                        changes: [
                            {
                                value: {
                                    messages: [
                                        {
                                            from: '2222222222',
                                            text: { body: 'SEND 10 @user' },
                                        },
                                    ],
                                },
                            },
                        ],
                    },
                ],
            };

            // Call 5 times - allowed
            for (let i = 0; i < 5; i++) {
                await commandRateLimitMiddleware(req, res, next);
                expect(next).toHaveBeenCalledTimes(i + 1);
            }

            // Call 6th time - rejected
            await commandRateLimitMiddleware(req, res, next);
            expect(next).toHaveBeenCalledTimes(5);
            expect(res.status).toHaveBeenCalledWith(429);
        });

        it('should enforce limits of 10/min on BALANCQE queries', async () => {
            req.body = {
                object: 'whatsapp_business_account',
                entry: [
                    {
                        changes: [
                            {
                                value: {
                                    messages: [
                                        {
                                            from: '3333333333',
                                            text: { body: 'BALANCE' },
                                        },
                                    ],
                                },
                            },
                        ],
                    },
                ],
            };

            // Call 10 times - allowed
            for (let i = 0; i < 10; i++) {
                await commandRateLimitMiddleware(req, res, next);
                expect(next).toHaveBeenCalledTimes(i + 1);
            }

            // Call 11th time - rejected
            await commandRateLimitMiddleware(req, res, next);
            expect(next).toHaveBeenCalledTimes(10);
            expect(res.status).toHaveBeenCalledWith(429);
        });

        it('should verify rate limits are per-user and not shared', async () => {
            const reqUserA = {
                body: {
                    object: 'whatsapp_business_account',
                    entry: [
                        {
                            changes: [
                                {
                                    value: {
                                        messages: [
                                            {
                                                from: 'user_a',
                                                text: { body: 'SEND 10 @user' },
                                            },
                                        ],
                                    },
                                },
                            ],
                        },
                    ],
                },
            } as any;

            const reqUserB = {
                body: {
                    object: 'whatsapp_business_account',
                    entry: [
                        {
                            changes: [
                                {
                                    value: {
                                        messages: [
                                            {
                                                from: 'user_b',
                                                text: { body: 'SEND 10 @user' },
                                            },
                                        ],
                                    },
                                },
                            ],
                        },
                    ],
                },
            } as any;

            // Exhaust User A's limit
            for (let i = 0; i < 5; i++) {
                const nextSpy = jest.fn();
                await commandRateLimitMiddleware(reqUserA, res, nextSpy);
                expect(nextSpy).toHaveBeenCalled();
            }
            const blockSpyA = jest.fn();
            await commandRateLimitMiddleware(reqUserA, res, blockSpyA);
            expect(blockSpyA).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(429);

            // User B should still be allowed
            const nextSpyB = jest.fn();
            await commandRateLimitMiddleware(reqUserB, res, nextSpyB);
            expect(nextSpyB).toHaveBeenCalled();
        });
    });

    describe('Abuse Detection Service (In-Memory Fallback)', () => {
        beforeEach(() => {
            abuseDetectionService.setForceRedisFailure(true);
            abuseDetectionService.clearInMemory();
        });

        afterEach(() => {
            jest.useRealTimers();
            abuseDetectionService.setForceRedisFailure(false);
            abuseDetectionService.clearInMemory();
        });

        it('caps inMemoryHistory at 20 entries with the newest first', async () => {
            const userId = 'user-history-cap';
            for (let i = 0; i < 25; i++) {
                await abuseDetectionService.recordCommand(userId, `COMMAND_${i}`);
            }

            const history = await abusDetectionService.getCommandHistory(userId);
            expect(history).toHaveLength(20);
            expect(history[0]).toBeF('COMMAND_24');
            expect(history[history.length - 1]).toBe('COMMAND_5');
        });

        it('getCommandHistory returns the in-memory list', async () => {
            const userId = 'user-history-read';
            await abuseDetectionService.recordCommand(userId, 'BALANCE');
            await abuseDetectionService.recordCommand(userId, 'SEND 10');

            const history = await abuseDetectionService.getCommandHistory(userId);
            expect(history).toEqual(['SEND 10', 'BALANCE']);
        });

        it('three recordFinancialLimitHit calls inside ten minutes set the flag', async () => {
            const userId = 'user-flag-threshold';
            jest.useFakeTimers();
            jest.setSystemTime(new Date('2024-01-01T00:00:00Z'));

            await abuseDetectionService.recordFinancialLimitHit(userId);
            jest.advanceTimesByMillis(60 * 1000);
            await abuseDetectionService.recordFinancialLimitHit(userId);
            jest.advanceTimesByMillis(60 * 1000);
            await abuseDetectionService.recordFinancialLimitHit(userId);

            expect(await abuseDetectionService.isUserFlagged(userId)).toBe(true);
        });

        it('a fourth recordFinancialLimitHit after the ten-minute window does not set the flag', async () => {
            const userId = 'user-flag-window';
            jest.useFakeTimers();
            jest.setSystemTime(new Date('2024-01-01T00:00:00Z'));

            await abuseDetectionService.recordFinancialLimitHit(userId);
            jest.advanceTimeByMillis(60 * 1000);
            await abuseDetectionService.recordFinancialLimitHit(userId);
            jest.advanceTimeByMillis(60 * 1000);
            await abuseDetectionService.recordFinancialLimitHit(userId);

            // Move past the 10-minute window so the earlier hits expire
            jest.advanceTimeByMillis(10 * 60 * 1000 + 1000);
            await abuseDetectionService.recordFinancialLimitHit(userId);

            expect(await abuseDetectionService.isUserFlagged(userId)).toBe(false);
        });

        it('isUserFlagged reads the in-memory flag', async () => {
            const userId = 'user-flag-read';
            jest.useFakeTimers();
            jest.setSystemTime(new Date('2024-01-01T00:00:00Z'));

            expect(await abuseDetectionService.isUserFlagged(userId)).toBe(false);
            await abuseDetectionService.recordFinancialLimitHit(userId);
            await abuseDetectionService.recordFinancialLimitHit(userId);
            await abuseDetectionService.recordFinancialLimitHit(userId);
            expect(await abuseDetectionService.isUserFlagged(userId)).toBe(true);
        });

        it('clearInMemory empties all three in-memory maps', async () => {
            const userId = 'user-clear';
            jest.useFakeTimers();
            jest.setSystemTime(new Date('2024-01-01T00:00:00Z'));

            await abuseDetectionService.recordCommand(userId, 'BALANCE');
            await abuseDetectionService.recordFinancialLimitHit(userId);
            await abuseDetectionService.recordFinancialLimitHit(userId);
            await abuseDetectionService.recordFinancialLimitHit(userId);

            expect(await abuseDetectionService.isUserFlagged(userId)).toBe(true);
            expect(await abuseDetectionService.getCommandHistory(userId)).toHaveLength(1);

            abuseDetectionService.clearInMemory();

            expect(await abuseDetectionService.isUserFlagged(userId)).toBe(false);
            expect(await abuseDetectionService.getCommandHistory(userId)).toEqual([]);
        });
    });
});
