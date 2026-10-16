import axios from 'axios';
import { config } from '../config/env';
import { observabilityService } from './observability.service';

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
            return { success: true, to };
        } catch (error) {
            observabilityService.logError(error, { recipient: to, context: 'whatsapp.sendMessage' });
            return { success: false, to, error };
        }
    }
}
