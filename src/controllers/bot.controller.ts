import type { Request, Response } from 'express';
import { config } from '../config/env';
import { enqueueMessage, type MessageJobData } from '../queue/message.queue';
import { observabilityService } from '../services/observability.service';

/**
 * Hard upper bound on how long we wait for a message to be enqueued before
 * giving up. Without this, a hung Redis/BullMQ connection would keep the
 * webhook request (and the WhatsApp delivery) open indefinitely.
 */
const ENQUEUE_TIMEOUT_MS = 10_000;

/**
 * Minimal, defensively-typed shape of the WhatsApp Cloud API webhook payload.
 * Every field is optional because the payload is attacker-controllable: the
 * webhook is public, so we must treat the body as untrusted and never assume a
 * field exists. We only model the slice we actually read.
 */
interface WhatsAppContact {
    wa_id?: string;
    profile?: {
        name?: string;
        locale?: string;
    };
}

interface WhatsAppTextMessage {
    from?: string;
    id?: string;
    text?: { body?: string };
}

interface WhatsAppChangeValue {
    messages?: WhatsAppTextMessage[];
    contacts?: WhatsAppContact[];
}

interface WhatsAppChange {
    value?: WhatsAppChangeValue;
}

interface WhatsAppEntry {
    changes?: WhatsAppChange[];
}

interface WhatsAppWebhookBody {
    object?: unknown;
    entry?: WhatsAppEntry[];
}

export interface IncomingTextMessage {
    from: string;
    msgBody: string;
    whatsappMessageId: string;
    locale?: string;
}

export class BotController {
    public verifyWebhook(req: Request, res: Response): void {
        const mode = req.query['hub.mode'];
        const token = req.query['hub.verify_token'];
        const challenge = req.query['hub.challenge'];

        if (typeof mode !== 'string' || typeof token !== 'string') {
            res.sendStatus(400);
            return;
        }

        if (mode === 'subscribe' && token === config.VERIFY_TOKEN) {
            console.log('WEBHOOK_VERIFIED');
            res.status(200).send(typeof challenge === 'string' ? challenge : '');
            return;
        }

        res.sendStatus(403);
    }

    /**
     * Safely extract every inbound text message from a (possibly malformed
     * or malicious) webhook body. Optional chaining is used end-to-end so a
     * partial or garbage payload can never throw a TypeError. The WhatsApp
     * envelope is an array at both the `entry` and `changes` levels, and each
     * change can carry several messages, so we iterate all of them instead of
     * reading the first element only.
     */
    private extractTextMessages(body: WhatsAppWebhookBody): IncomingTextMessage[] {
        const result: IncomingTextMessage[] = [];
        const entries = Array.isArray(body.entry) ? body.entry : [];

        for (const entry of entries) {
            const changes = Array.isArray(entry?.changes) ? entry.changes : [];

            for (const change of changes) {
                const value = change?.value;
                const messages = Array.isArray(value?.messages) ? value.messages : [];
                const contacts = value?.contacts;

                for (const message of messages) {
                    const from = message?.from;
                    const msgBody = message?.text?.body;
                    const id = message?.id;

                    if (
                        typeof from !== 'string' ||
                        typeof msgBody !== 'string' ||
                        msgBody.length === 0 ||
                        typeof id !== 'string'
                    ) {
                        continue;
                    }

                    // Try to extract locale if available in contacts metadata for this sender
                    let locale: string | undefined;
                    const contact = contacts?.find((c) => c?.wa_id === from);
                    if (contact && contact.profile?.locale) {
                        locale = contact.profile.locale;
                    }

                    result.push({ from, msgBody, whatsappMessageId: id, locale });
                }
            }
        }

        return result;
    }

    public async handleMessage(req: Request, res: Response) {
        const body = (req.body ?? {}) as WhatsAppWebhookBody;

        if (!body.object) {
            res.sendStatus(404);
            return;
        }

        const messages = this.extractTextMessages(body);

        if (messages.length === 0) {
            // Valid webhook event that carries nothing for us to act on
            // (status update, empty body, non-text message, etc.). Acknowledge.
            res.sendStatus(200);
            return;
        }

        observabilityService.logInfo('Received webhook message');

        // Enqueue every message in the batch. We await all of them so the
        // response reflects whether the whole delivery was handled.
        const results = await Promise.allSettled(
            messages.map((message) =>
                this.enqueueWithTimeout({
                    from: message.from,
                    msgBody: message.msgBody,
                    whatsappMessageId: message.whatsappMessageId,
                    locale: message.locale,
                }),
            ),
        );

        const failures = results.filter((r) => r.status === 'rejected');

        if (failures.length > 0) {
            const firstFailure = failures[0] as PromiseRejectedResult;
            observabilityService.alertCriticalFailure('Failed to enqueue webhook message', firstFailure.reason, {
                from: messages[0].from,
                failedCount: failures.length,
                totalCount: messages.length,
            });
            // Let a queue/Redis failure surface as an unhandled promise
            // rejection. Returning 500 makes WhatsApp retry delivery rather
            // than silently dropping the message -- important for a financial
            // app where a lost message can mean a lost transaction.
            res.sendStatus(500);
            return;
        }

        res.sendStatus(200);
    }

    /**
     * Enqueue a message with a hard timeout so a stalled queue connection can
     * never hang the webhook. Resolves once the job is queued; rejects on the
     * enqueue error or when ENQUEUE_TIMEOUT_MS elapses. The timer is always
     * cleared so it cannot keep the event loop alive.
     */
    private async enqueueWithTimeout(data: MessageJobData): Promise<void> {
        let timer!: ReturnType<typeof setTimeout>;
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(
                () => reject(new Error(`enqueueMessage timed out after ${ENQUEUE_TIMEOUT_MS}ms`)),
                ENQUEUE_TIMEOUT_MS,
            );
        });

        try {
            await Promise.race([enqueueMessage(data), timeout]);
        } finally {
            clearTimeout(timer);
        }
    }
}
