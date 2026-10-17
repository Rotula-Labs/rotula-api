jest.mock('../config/env', () => ({
    config: {
        WHATSAPP_PHONE_NUMBER_ID: '1234567890',
        WHATSAPP_TOKEN: 'test-whatsapp-token',
    },
}));

jest.mock('axios', () => ({
    __esModule: true,
    default: {
        post: jest.fn(),
        isAxiosError: (e) => Boolean(e)?.isAxiosError,
    },
}));

import axios from 'axios';
import { WhatsAppService } from '../services/whatsapp.service';

const mockedPost = axios.post as unknown as jest.Mock;

describe('WhatsAppService.sendMessage', () => {
    let service: WhatsAppService;
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        service = new WhatsAppService();
        mockedPost.mockReset();
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    it('POSTs to the configured Graph API URL with the bearer token and text payload', async () => {
        mockedPost.mockResolvedOnce({ status: 200, data: { messages: [{ id: 'wamid.message-id-123' }] } });

        const result = await service.sendMessage('+2348000000000', 'Hello group');

        expect(mockedPost).toHaveBeenCalledTimes(1);
        expect(mockedPost).toHaveBeenCalledWith(
            'https://graph.facebook.com/v17.0/1234567890/messages',
            {
                messaging_product: 'whatsapp',
                to: '+2348000000000',
                type: 'text',
                text: { body: 'Hello group' },
            },
            {
                headers: {
                    Authorization: 'Bearer test-whatsapp-token',
                    'Content-Type': 'application/json',
                },
            },
        );
        expect(result).toEqual({
            ok: true,
            messageId: 'wamid.message-id-123',
        });
    });

    it('reports a failed delivery with a failure class when axios.post rejects', async () => {
        const networkError = Object.assign(new Error('network down'), {
            isAxiosError: true,
            code: 'ECONNRESET',
        });
        mockedPost.mockRejectedOnce(networkError);

        const result = await service.sendMessage('+2348000000000', 'Hello group');

        expect(mockedPost).toHaveBeenCalledTimes(1);
        expect(consoleErrorSpy).toHaveBeenCalled();
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.failureClass).toBe('network');
            expect(result.error).toBe(networkError);
        }
    });

    it('reports an HTTP failure class when the provider responds with an error status', async () => {
        const httpError = Object.assign(new Error('Request failed with status code 400'), {
            isAxiosError: true,
            response: { status: 400, data: { error: { message: 'invalid token' } } },
        });
        mockedPost.mockRejectedOnce(httpError);

        const result = await service.sendMessage('+2348000000000', 'Hello group');

        expect(consoleErrorSpy).toHaveBeenCalled();
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.failureClass).toBe('http');
            expect(result.statusCode).toBe(400);
        }
    });

    it('reports an unknown failure class for non-axios errors', async () => {
        mockedPost.mockRejectedOnce(new Error('unexpected'));

        const result = await service.sendMessage('+2348000000000', 'Hello group');

        expect(consoleErrorSpy).toHaveBeenCalled();
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.failureClass).toBe('unknown');
        }
    });
});
