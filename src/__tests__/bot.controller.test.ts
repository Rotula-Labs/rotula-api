import { BotController } from '../controllers/bot.controller';
import { Request, Response } from 'express';

const mockEnqueueMessage = jest.fn().mockResolvedValue({ id: 'mock-job-id' });
const mockIsMessageProcessed = jest.fn().mockResolvedValue(false);

jest.mock('../queue/message.queue', () => ({
    enqueueMessage: (...args: any[]) => mockEnqueueMessage(...args),
}));

jest.mock('../config/env', () => ({
    config: { VERIFY_TOKEN: 'test_token' },
}));

jest.mock('../services/observability.service', () => ({
    observabilityService: { logInfo: jest.fn(), alertCriticalFailure: jest.fn() },
}));

jest.mock('../services/deduplication.service', () => ({
    isMessageProcessed: (...args: any[]) => mockIsMessageProcessed(...args),
}));

describe('BotController', () => {
    let botController: BotController;
    let mockReq: Partial<Request>;
    let mockRes: Partial<Response>;

    beforeEach(() => {
        jest.clearAllMocks();
        mockIsMessageProcessed.mockResolvedValue(false);
        botController = new BotController();
        mockRes = { sendStatus: jest.fn(), status: jest.fn().mockReturnThis(), send: jest.fn() };
    });

    const createWebhookPayload = (text: string) => ({
        object: 'whatsapp_business_account',
        entry: [{ changes: [{ value: { metadata: { phone_number_id: '123' }, messages: [{ from: '12345', id: 'wamid.123', text: { body: text } }] } }] }],
    });

    describe('verifyWebhook', () => {
        it('should return challenge for valid verify token', () => {
            mockReq = {
                query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'test_token', 'hub.challenge': '12345_challenge' },
            };
            process.env.VERIFY_TOKEN = 'test_token';
            botController.verifyWebhook(mockReq as Request, mockRes as Response);
            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.send).toHaveBeenCalledWith('12345_challenge');
        });

        it('should send empty challenge when challenge param is missing', () => {
            mockReq = {
                query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'test_token' },
            };
            botController.verifyWebhook(mockReq as Request, mockRes as Response);
            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.send).toHaveBeenCalledWith('');
        });

        it('should return 403 for invalid verify token', () => {
            mockReq = {
                query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong_token', 'hub.challenge': '12345_challenge' },
            };
            process.env.VERIFY_TOKEN = 'test_token';
            botController.verifyWebhook(mockReq as Request, mockRes as Response);
            expect(mockRes.sendStatus).toHaveBeenCalledWith(403);
        });

        it('should return 400 for missing params', () => {
            mockReq = { query: {} };
            botController.verifyWebhook(mockReq as Request, mockRes as Response);
            expect(mockRes.sendStatus).toHaveBeenCalledWith(400);
        });
    });

    describe('handleMessage', () => {
        it('should return 200 immediately and enqueue job for valid payload', async () => {
            mockReq = { body: createWebhookPayload('SEND 10 @jane') };
            await botController.handleMessage(mockReq as Request, mockRes as Response);
            expect(mockRes.sendStatus).toHaveBeenCalledWith(200);
            expect(mockEnqueueMessage).toHaveBeenCalledWith({
                from: '12345',
                msgBody: 'SEND 10 @jane',
                whatsappMessageId: 'wamid.123',
            });
        });

        it('should extract locale from contact profile if available', async () => {
            const payload = createWebhookPayload('HELLO');
            (payload.entry[0].changes[0].value as any).contacts = [{
                wa_id: '12345',
                profile: { name: 'Jane', locale: 'fr' }
            }];
            mockReq = { body: payload };
            await botController.handleMessage(mockReq as Request, mockRes as Response);
            expect(mockRes.sendStatus).toHaveBeenCalledWith(200);
            expect(mockEnqueueMessage).toHaveBeenCalledWith({
                from: '12345',
                msgBody: 'HELLO',
                whatsappMessageId: 'wamid.123',
                locale: 'fr',
            });
        });

        it('should return 200 and not enqueue for empty message body', async () => {
            const payload = createWebhookPayload('');
            payload.entry[0].changes[0].value.messages[0].text.body = '';
            mockReq = { body: payload };
            await botController.handleMessage(mockReq as Request, mockRes as Response);
            expect(mockRes.sendStatus).toHaveBeenCalledWith(200);
            expect(mockEnqueueMessage).not.toHaveBeenCalled();
        });

        it('should enqueue every message in a two-message batched payload', async () => {
            const payload = createWebhookPayload('SEND 10 @jane');
            (payload.entry[0].changes[0].value as any).messages.push({
                from: '12345',
                id: 'wamid.456',
                text: { body: 'BALANCE' },
            });
            mockReq = { body: payload };

            await botController.handleMessage(mockReq as Request, mockRes as Response);

            expect(mockEnqueueMessage).toHaveBeenCalledTimes(2);
            expect(mockEnqueueMessage).toHaveBeenNthCalledWith(1, {
                from: '12345',
                msgBody: 'SEND 10 @jane',
                whatsappMessageId: 'wamid.123',
            });
            expect(mockEnqueueMessage).toHaveBeenNthCalledWith(2, {
                from: '12345',
                msgBody: 'BALANCE',
                whatsappMessageId: 'wamid.456',
            });
            expect(mockRes.sendStatus).toHaveBeenCalledWith(200);
        });

        it('should return 200 even without messages array', async () => {
            mockReq = { body: { object: 'whatsapp_business_account', entry: [{ changes: [{ value: {} }] }] } };
            await botController.handleMessage(mockReq as Request, mockRes as Response);
            expect(mockRes.sendStatus).toHaveBeenCalledWith(200);
            expect(mockEnqueueMessage).not.toHaveBeenCalled();
        });

        it('should return 404 for non-object payloads', async () => {
            mockReq = { body: {} };
            await botController.handleMessage(mockReq as Request, mockRes as Response);
            expect(mockRes.sendStatus).toHaveBeenCalledWith(404);
            expect(mockEnqueueMessage).not.toHaveBeenCalled();
        });

        it('should return 404 for missing body', async () => {
            mockReq = {};
            await botController.handleMessage(mockReq as Request, mockRes as Response);
            expect(mockRes.sendStatus).toHaveBeenCalledWith(404);
            expect(mockEnqueueMessage).not.toHaveBeenCalled();
        });

        it.each([
            ['an Error', new Error('redis down')],
            ['a string', 'redis down'],
            ['a non-error value', { code: 500 }],
        ])('should return 500 when enqueue rejects with %s so WhatsApp retries', async (_label, reason) => {
            mockEnqueueMessage.mockRejectedValueOnce(reason);
            mockReq = { body: createWebhookPayload('BALANCE') };
            await botController.handleMessage(mockReq as Request, mockRes as Response);
            expect(mockRes.sendStatus).toHaveBeenCalledWith(500);
            expect(mockEnqueueMessage).toHaveBeenCalledTimes(1);
        });

        it('should not process a message that was already handled on redelivery', async () => {
            mockIsMessageProcessed.mockResolvedValueOnce(true);
            mockReq = { body: createWebhookPayload('SEND 10 @jane') };

            await botController.handleMessage(mockReq as Request, mockRes as Response);

            expect(mockIsMessageProcessed).toHaveBeenCalledWith('wamid.123');
            expect(mockEnqueueMessage).not.toHaveBeenCalled();
            expect(mockRes.sendStatus).toHaveBeenCalledWith(200);
        });
    });

    describe('handleMessage - reliability edge cases', () => {
        // Malformed/hostile payloads that must never throw (the old guard chain
        // crashed on several of these, surfacing as an unhandled rejection).
        const malformedPayloads: Array<[string, any]> = [
            ['empty entry array', { object: 'x', entry: [] }],
            ['entry with empty object', { object: 'x', entry: [{}] }],
            ['empty changes array', { object: 'x', entry: [{ changes: [] }] }],
            ['change without value', { object: 'x', entry: [{ changes: [{}] }] }],
            ['null entry', { object: 'x', entry: null }],
            ['undefined body', undefined],
            ['messages is not an array', { object: 'x', entry: [{ changes: [{ value: { messages: 'oops' } }] }] }],
            ['message missing from', { object: 'x', entry: [{ changes: [{ value: { messages: [{ text: { body: 'hi' } }] } }] }] }],
            ['message missing text', { object: 'x', entry: [{ changes: [{ value: { messages: [{ from: '123' }] } }] }] }],
        ];

        it.each(malformedPayloads)(
            'acknowledges (200) without throwing or enqueuing for %s',
            async (_label, body) => {
                mockReq = { body };
                await expect(
                    botController.handleMessage(mockReq as Request, mockRes as Response),
                ).resolves.toBeUndefined();

                // undefined body has no `object`, so it is a 404; every other
                // malformed-but-structured payload is a benign 200 ack.
                const expectedStatus = body && body.object ? 200 : 404;
                expect(mockRes.sendStatus).toHaveBeenCalledWith(expectedStatus);
                expect(mockEnqueueMessage).not.toHaveBeenCalled();
            },
        );

        it('returns 500 when enqueue fails so WhatsApp retries delivery', async () => {
            mockEnqueueMessage.mockRejectedValueOnce(new Error('redis down'));
            mockReq = { body: createWebhookPayload('SEND 5 @ada') };

            await botController.handleMessage(mockReq as Request, mockRes as Response);

            expect(mockEnqueueMessage).toHaveBeenCalledTimes(1);
            expect(mockRes.sendStatus).toHaveBeenCalledWith(500);
        });

        it('returns 500 when enqueue exceeds the timeout', async () => {
            jest.useFakeTimers();
            try {
                // Simulate a hung queue connection that never settles.
                mockEnqueueMessage.mockReturnValueOnce(new Promise(() => {}));
                mockReq = { body: createWebhookPayload('HISTORY') };

                const pending = botController.handleMessage(mockReq as Request, mockRes as Response);
                await jest.advanceTimersByTimeAsync(10_000);
                await pending;

                expect(mockRes.sendStatus).toHaveBeenCalledWith(500);
            } finally {
                jest.useRealTimers();
            }
        });

        it('returns 500 when any message in a batch fails to enqueue', async () => {
            const payload = createWebhookPayload('SEND 10 @jane');
            (payload.entry[0].changes[0].value as any).messages.push({
                from: '12345',
                id: 'wamid.456',
                text: { body: 'BALANCE' },
            });
            mockEnqueueMessage
                .mockResolvedValueOnce({ id: 'job-1' })
                .mockRejectedValueOnce(new Error('redis down'));
            mockReq = { body: payload };

            await botController.handleMessage(mockReq as Request, mockRes as Response);

            expect(mockEnqueueMessage).toHaveBeenCalledTimes(2);
            expect(mockRes.sendStatus).toHaveBeenCalledWith(500);
        });
    });
});
