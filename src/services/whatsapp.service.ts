import axios from 'axios';
import { config } from '../config/env';
import { metrics } from './observability.service';

export class WhatsAppService {
    private apiUrl = `https://graph.facebook.com/v17.0/${config.WHATSAPP_PHONE_NUMBER_ID}/messages`;

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
            metrics.increment('whatsapp_send_success');
            metrics.increment('outbound_send');
        } catch (error) {
            console.error('Error sending WhatsApp message:', error);
            metrics.increment('whatsapp_send_failure');
            metrics.increment('outbound_send_failure');
        }
    }
}
