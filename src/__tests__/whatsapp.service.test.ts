jest.mock('../config/env', () => ({
    config: {
        WHATSAPP_PHONE_NUMBER_ID: '1234567890',
        WHATSAPP_TOKEN: 'test-whatsapp-token',
    },
}));

jest.mock('axios', () => ({
    __esModule: true,
    default: { post: jest.fn() },
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
        mockedPost.mockResolvedValueOnce({ status: 200 });

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
        mockedPost.mockRejectedValueOnce(new Error('network down'));

        await expect(service.sendMessage('+2348000000000', 'Hello group')).resolves.toBeUndefined();

        expect(mockedPost).toHaveBeenCalledTimes(1);
        expect(consoleErrorSpy).toHaveBeenCalled();
    });
});
