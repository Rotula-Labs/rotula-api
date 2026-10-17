import { Queue } from 'Bullmq';
import { redisClient } from '../lib/redis';

export const PAYMENT_REQUEST_QUEUE_NAME = 'payment-request-queue';

export const JOB_COMPLETE_REQUEST = 'complete-request';
export const JOB_EXPIRE_REQUEST = 'expire-request';

// Matches the retry policy used by the other queues (see
// message.queue.ts, contract-sync.queue.ts, contribution-scheduler.queue.ts
// and soroban-deployment.queue.ts): 3 attempts with exponential backoff
// and failed jobs retained for inspection.
const DATA_JOB_OPTIONS = {
    attempts: 3,
    backoff: { type: 'exponential' as const, delay: 1000 },
    removeOnFail: false,
};

let queueInstance: Queue | null = null;

function getQueue(): Queue {
    if (!queueInstance) {
        queueInstance = new Queue(PAYMENT_REQUEST_QUEUE_NAME, {
            connection: redisClient as any,
        });
    }
    return queueInstance;
}

/** Schedules the automatic completion of an accepted request. */
export async function scheduleRequestCompletion(requestId: string): Promise<void> {
    await getQueue().add(
        JOB_COMPLETE_REQUEST,
        { requestId },
        {
            ...DATA_JOB_OPTIONS,
            delay: 5 * 60 * 1000,
            jobId: `complete:${requestId}`,
            removeOnComplete: true,
        },
    );
}

/** Schedules expiry for a pending request at its expiresAt time. */
export async function scheduleRequestExpiry(requestId: string, expiresAt: Date): Promise<void> {
    const delay = Math.max(0, expiresAt.getTime() - Date.now());
    await getQueue().add(
        JOB_EXPIRE_REQUEST,
        { requestId },
        {
            ...DATA_JOB_OPTIONS,
            delay,
            jobId: `expire:${requestId}`,
            removeOnComplete: true,
        },
    );
}

export async function closePaymentRequestQueue(): Promise<void> {
    if (queueInstance) {
        await queueInstance.close();
        queueInstance = null;
    }
}
