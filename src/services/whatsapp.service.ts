import axios from 'axios';
import { config } from '../config/env';

const WHATSAPP_MAX_BODY_LENGTH = 4096;
const SPLIT_MARKER = '\n\n[continued]';

export class WhatsAppService {
    private apiUrl = `https://graph.facebook.com/v17.0/${config.WHATSAPP_PHONE_NUMBER_ID}/messages`;

    public async sendMessage(to: string, text: string) {
        const chunks = this.splitMessage(text);
        for (const chunk of chunks) {
            await this.postMessage(to, chunk);
        }
    }

    private splitMessage(text: string): string[] {
        if (text.length <= WHATSAPP_MAX_BODY_LENGTH) {
            return [text];
        }

        const chunks: string[] = [];
        let remaining = text;
        const limit = WHATSAPP_MAX_BODY_LENGTH - SPLIT_MARKER.length;

        while (remaining.length > WHATSAPP_MAX_BODY_LENGTH) {
            let splitAt = remaining.lastIndexOf('\n', limit);
            if (splitAt <= 0) {
                splitAt = remaining.lastIndexOf(' ', limit);
            }
            if (splitAt <= 0) {
                splitAt = limit;
            }
            chunks.push(remaining.slice(0, splitAt) + SPLIT_MARKER);
            remaining = remaining.slice(splitAt).replace(/^\s+/, '');
        }
        chunks.push(remaining);

        console.warn(
            `WhatsApp message exceeded ${WHATSAPP_MAX_BODY_LENGTH} chars; split into ${chunks.length} parts.`
        );
        return chunks;
    }

    private async postMessage(to: string, text: string) {
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
            throw error;
        }
    }
}
