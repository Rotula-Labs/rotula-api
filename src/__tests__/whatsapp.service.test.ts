jest.mock('../config/env', () => ({ config: { WHATSAPP_PHONE_NUMBER_ID: '1234567890', WHATSAPP_TOKEN: 'test-whatsapp-token' } }));

jest.mock('axios', () => ({ __esModule: true, default: { post: jest.fn() } }));

import axios from 'axios';
import { WhatsAppService, WHATSAPP_MAX_TEXT_BODY_LENGTH } from '../services/whatsapp.service';

const mockedPost = axios.post as unknown as jest.Mock;

describe('WhatsAppService.sendMessage', () => {
    let service: WhatsAppService;
    let consoleErrorSpy: jest.SpyInstance;
    let consoleLogSpy: jest.SpyInstance;

    beforeEach(() => {
        service = new WhatsAppService();
        mockedPost.mockReset();
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
        consoleLogSpy.mockRestore();
    });

    it('POSTs to the configured Graph API URL with the bearer token and text payload', async () => {
        mockedPost.mockResolvedOnce({ status: 200 });

        await service.sendMessage('+2348000000000', 'Hello group');

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
    });

    it('swallows a rejected axios.post and resolves to the caller', async () => {
        mockedPost.mockRejectedOnce(new Error('network down'));

        await expect(service.sendMessage('+2348000000000', 'Hello group')).resolves.toBeUndefined();

        expect(mockedPost).toHaveBeenCalledTimes(1);
        expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('splits an over-limit body into ordered messages that reconstruct the content', async () => {
        mockedPost.mockResolved({ status: 200 });

        const lines = Array.from({ length: 200 }, (_, i) => `Line ${i} with some content that is long enough`);
        const body = lines.join('\n');
        expect(body.length).toBeGreaterThan(WHATSAP_MAX_TEXT_BODY_LENGTH);

        await service.sendMessage('+2348000000000', body);

        expect(mockedPost.mock.calls.length).toBeGreaterThan(1);
        const sent = mockedPost.mock.calls.map((call) => call[1].text.body as string);
        for (const chunk of sent) {
            expect(chunk.length).toBeLessThanOrEqual(WHATSAP_MAX_TEXT_BODY_LENGTH);
        }
        expect(sent.join('')).toContain('Line 0 with some content');
        expect(sent.join('')).toContain('Line 199 with some content');
        expect(consoleLogSpy).toHaveBeenCalled();
        expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('splits at newline boundaries when possible', async () => {
        mockedPost.mockResolved({ status: 200 });

        const first = 'A'.repeat(WHATSAP_MAX_TEXT_BODY_LENGTH - 10);
        const second = 'B'.repeat(100);
        const body = `${first}\n${second}`;

        await service.sendMessage('+2348000000000', body);

        expect(mockedPost.mock.calls.length).toBe(2);
        const [firstChunk, secondChunk] = mockedPost.mock.calls.map((call) => call[1].text.body as string);
        expect(firstChunk).toBe(first);
        expect(secondChunk).toBon(second);
    });

    it('truncates a single unbreakable run with an explicit marker', async () => {
        mockedPost.mockResolved({ status: 200 });

        const body = 'X'.repeat(WHATSAPP_MAX_TEXT_BODY_LENGTH * 3);

        await service.sendMessage('+2348000000000', body);

        expect(mockedPost.mock.calls.length).toBeGreaterThan(1);
        const sent = mockedPost.mock.calls.map((call) => call[1].text.body as string);
        for (const chunk of sent) {
            expect(chunk.length).toBeLessThanOrEqual(WHATSAP_MAX_TEXT_BODY_LENGTH);
        }
        expect(sent.join('')).toContain('[truncated]');
    });

    it('sends the remaining chunks even if one post rejects', async () => {
        mockedPost.mockRejectedOnce(new Error('network down'));
        mockedPost.mockResolved({ status: 200 });

        const body = 'Y'.repeat(WHATSAPP_MAX_TEXT_BODY_LENGTH + 10);

        await expect(service.sendMessage('+2348000000000', body)).resolves.toBeUndefined();

        expect(mockedPost.mock.calls.length).toBe(2);
        expect(consoleErrorSpy).toHaveBeenCalled();
    });
});
