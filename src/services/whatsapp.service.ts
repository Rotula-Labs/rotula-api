import axios from 'axios';
import { config } from '../config/env';

// Bounded retry policy for outbound WhatsApp sends.
// Attempts: 1 initial try + 2 retries = 3 total attempts (documented bound).
// Timeout: 10s per attempt. Worst-case latency: 3 * 10s + backoff (~0.3s + ~0.6s)
// ≈ 30.9s, which is safe to await from a request path.
const MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 10_000;
const BASE_BACKOFF_MS = 300;

// Only idempotent failure classes are retried: connection errors, 408, 429, 5xx.
// A 4xx other than 408/429 is the caller's fault and must not be retried.
function isRetryable(error: unknown): boolean {
    if (!axios.isAxiosError(error)) {
        return false;
    }
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
        return true;
    }
    if (!error.response) {
        // Connection error (no response received).
        return true;
    }
    const status = error.response.status;
    return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

function backoffDelay(attempt: number): number {
    const exponential = BASE_BACKOFF_MS * 2 ** (attempt - 1);
    const jitter = Math.random() * BASE_BACKOFF_MS;
    return exponential + jitter;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export class WhatsAppService {
    private apiUrl = `https://graph.facebook.com/v17.0/${config.WHATSAPP_PHONE_NUMBER_ID}/messages`;

    public async sendMessage(to: string, text: string) {
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
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
                        timeout: REQUEST_TIMEOUT_MS,
                        headers: {
                            Authorization: `Bearer ${config.WHATSAPP_TOKEN}`,
                            'Content-Type': 'application/json',
                        },
                    }
                );
                return;
            } catch (error) {
                if (attempt < MAX_ATTEMPTS && isRetryable(error)) {
                    await sleep(backoffDelay(attempt));
                    continue;
                }
                console.error('Error sending WhatsApp message:', error);
                return;
            }
        }
    }
}
