import axios from 'axios';
import { config } from '../config/env';

export type WhatsAppSendResult =
    | { status: 'delivered'; messageId: string }
    | { status: 'failed'; failureClass: WhatsAppFailureClass; error: unknown };

export type WhatsAppFailureClass =
    | 'network'
    | 'auth'
    | 'rate_limit'
    | 'invalid_recipient'
    | 'provider'
    | 'unknown';

function classifyFailure(error: unknown): WhatsAppFailureClass {
    if (axios.isAxiosError(error)) {
        if (!error.response) {
            return 'network';
        }
        const status = error.response.status;
        if (status === 401 || status === 403) {
            return 'auth';
        }
        if (status === 429) {
            return 'rate_limit';
        }
        if (status === 400 || status === 404) {
            return 'invalid_recipient';
        }
        if (status >= 500) {
            return 'provider';
        }
    }
    return 'unknown';
}

export class WhatsAppService {
    private apiUrl = `https://graph.facebook.com/v17.0/${config.WHATSAPP_PHONE_NUMBER_ID}/messages`;

    public async sendMessage(to: string, text: string): Promise<WhatsAppSendResult> {
        try {
            const response = await axios.post(
                this.apiUrl,
                {
                    messaging_product: 'whatsapp',
                    to: to,
                    type: 'text',
                    text: { body: text },
                },
                {
                    headers: {
                        Authorization: `Bearer ${config.WHATSAP_TOKEN}`,
                        'Content-Type': 'application/json',
                    },
                }
            );
            const messageId: string | undefined = response.data?.messages?.[0]?.id;
            return { status: 'delivered', messageId: messageId ?? '' };
        } catch (error) {
            console.error('Error sending WhatsApp message:', error);
            return { status: 'failed', failureClass: classifyFailure(error), error };
        }
    }
}
