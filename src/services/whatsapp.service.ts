import axios from 'axios';
import { config } from '../config/env';

export const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export class WhatsAppService {
    private apiUrl = `https://graph.facebook.com/v17.0/${config.WHATSAPP_PHONE_NUMBER_ID}/messages`;
    private lastInboundAt = new Map<string, number>();

    public async sendMessage(to: string, text: string) {
        try {
            await axios.post(
                this.apiUrl,
                {
                    messaging_product: 'whatsapp',
                    to: to,
                    type: 'text',
                    text: { body: text },
                },
                {
                    headers: {
                        Authorization: `Bearer ${config.WHATSAPP_TOKEN}`,
                        'Content-Type': 'application/json',
                    },
                }
            );
        } catch (error) {
            console.error('Error sending WhatsApp message:', error);
        }
    }

    public recordInboundMessage(from: string, timestampMs: number = Date.now()) {
        this.lastInboundAt.set(from, timestampMs);
    }

    public isWithinCustomerServiceWindow(to: string, nowMs: number = Date.now()): boolean {
        const lastInbound = this.lastInboundAt.get(to);
        if (lastInbound === undefined) {
            return false;
        }
        return nowMs - lastInbound < CUSTOMER_SERVICE_WINDOW_MS;
    }

    public async sendNotification(to: string, text: string) {
        if (this.isWithinCustomerServiceWindow(to)) {
            return this.sendMessage(to, text);
        }
        return this.sendTemplateMessage(to, config.WHATSAPP_TEMPLATE_NAME, [text]);
    }

    public async sendTemplateMessage(to: string, templateName: string, parameters: string[]) {
        try {
            await axios.post(
                this.apiUrl,
                {
                    messaging_product: 'whatsapp',
                    to: to,
                    type: 'template',
                    template: {
                        name: templateName,
                        language: { code: config.WHATSAPP_TEMPLATE_LANGUAGE },
                        components: [
                            {
                                type: 'body',
                                parameters: parameters.map((value) => ({ type: 'text', text: value })),
                            },
                        ],
                    },
                },
                {
                    headers: {
                        Authorization: `Bearer ${config.WHATSAPP_TOKEN}`,
                        'Content-Type': 'application/json',
                    },
                }
            );
        } catch (error) {
            console.error('Error sending WhatsApp message:', error);
        }
    }
}
