import { Queue, Job } from 'bullmq';
import { config } from '../config/env';
import crypto from 'crypto';

export interface MessageJobData {
    from: string;
    msgBody: string;
    whatsappMessageId: string;
    locale?: string;
}

const connection = {
    url: config.REDIS_URL,
};

const defaultJobOptions = {
    attempts: 3,
    backoff: {
        type: 'exponential' as const,
        delay: 1000,
    },
    removeOnComplete: true,
    removeOnFail: false,
};

let queueInstance: Queue | null = null;

function getQueue(): Queue {
    if (!queueInstance) {
        queueInstance = new Queue('message-processing', {
            connection,
            defaultJobOptions,
        });
    }
    return queueInstance;
}

export async function enqueueMessage(data: MessageJobData): Promise<Job> {
    const queue = getQueue();
    // Use the native WhatsApp message ID directly as the BullMQ jobId.
    // This ensures that if WhatsApp retries a webhook delivery for the exact same message,
    // BullMQ will treat it as a duplicate and safely ignore it.
    const jobId = data.whatsappMessageId;

    return await queue.add('process-message', data, {
        jobId,
    });
}

/**
 * Enqueue every message in a batch. Each message is keyed by its WhatsApp
 * message id, so a redelivered payload cannot process the same message twice.
 *
 * Returns the result for each message so callers can report success only when
 * every message in the batch was handled.
 */
export async function enqueueMessages(
    messages: MessageJobData[],
): Promise<PromiseSettledResult<Job>[]> {
    const results = await Promise.allSettled(messages.map((message) => enqueueMessage(message)));
    return results;
}

export async function closeQueue(): Promise<void> {
    if (queueInstance) {
        await queueInstance.close();
        queueInstance = null;
    }
}
