import { Queue, Job } from 'bullmq';
import { config } from '../config/env';
import { redisClient } from '../lib/redis';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const connection = { url: config.REDIS_URL };

const defaultJobOptions = {
    attempts: 3,
    backoff: {
        type: 'exponential' as const,
        delay: 1000,
    },
    removeOnComplete: true,
    removeOnFail: false, // Keep failed jobs in DLQ for manual inspection and retry
};

let queueInstance: Queue | null = null;

export function getSorobanDeploymentQueue(): Queue {
    if (!queueInstance) {
        queueInstance = new Queue('soroban-deployment', {
            connection,
            defaultJobOptions,
        });
    }
    return queueInstance;
}

/**
 * Enqueues an async contract deployment job for a group.
 */
export async function enqueueContractDeployment(groupId: string): Promise<Job | null> {
    if (redisClient.status !== 'ready') {
        console.warn('Redis is not ready, unable to enqueue contract deployment immediately.');
        return null;
    }

    const queue = getSorobanDeploymentQueue();
    const jobId = `deploy-contract:${groupId}`;

    return await queue.add(
        'deploy-contract',
        { groupId },
        { jobId }
    );
}

/**
 * Dead-Letter Queue (DLQ): Returns all failed deployments from the database.
 */
export async function getFailedDeployments(): Promise<any[]> {
    return await prisma.savingsGroup.findMany({
        where: { deploymentStatus: 'FAILED' },
        include: { members: { include: { user: true } } },
    });
}

/**
 * Dead-Letter Queue (DLQ): Manually retries a failed deployment for a group.
 */
export async function retryFailedDeployment(groupId: string): Promise<Job | null> {
    // Reset group deployment status to PENDING and clear error
    await prisma.savingsGroup.update({
        where: { id: groupId },
        data: {
            deploymentStatus: 'PENDING',
            deploymentError: null,
        },
    });

    const queue = getSorobanDeploymentQueue();
    const jobId = `deploy-contract:${groupId}:${Date.now()}`;

    return await queue.add(
        'deploy-contract',
        { groupId },
        { jobId }
    );
}

/**
 * Reconciliation: finds groups that are sttill PENDING but have no
 * deployment job (e.g. because Redis was down at creation time) and re-enqueues
 * them. Returns the number of groups that were re-enqueued.
 */
export async function reconcilePendingDeployments(): Promise<number> {
    if (redisClient.status !== 'ready') {
        console.warn('Redis is not ready, skipping deployment reconciliation.');
        return 0;
    }

    const pendingGroups = await prisma.savingsGroup.findMany({
        where: { deploymentStatus: 'PENDING' },
        select: { id: true },
    });

    const queue = getSorobanDeploymentQueue();
    let reenqueued = 0;

    for (const group of pendingGroups) {
        const jobId = `deploy-contract:${group.id}`;
        const existing = await queue.getJob(jobId);
        if (existing) {
            continue;
        }

        await queue.add(
            'deploy-contract',
            { groupId: group.id },
            { jobId }
        );
        reenqueued += 1;
    }

    return reenqueued;
}

export async function closeSorobanDeploymentQueue(): Promise<void> {
    if (queueInstance) {
        await queueInstance.close();
        queueInstance = null;
    }
}
