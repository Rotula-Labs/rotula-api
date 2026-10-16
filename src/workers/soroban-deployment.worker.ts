import { Worker, Job } from 'bullmq';
import { config } from '../config/env';
import { PrismaClient } from '@prisma/client';
import { sorobanService } from '../services/soroban.service';
import { observabilityService } from '../services/observability.service';
import { applyEncryptionMiddleware } from '../middleware/prisma-encryption.middleware';

const prisma = new PrismaClient();
applyEncryptionMiddleware(prisma);
const connection = { url: config.REDIS_URL };

let workerInstance: Worker | null = null;

export function startSorobanDeploymentWorker(): void {
    if (workerInstance) return;

    workerInstance = new Worker(
        'soroban-deployment',
        async (job: Job) => {
            const { groupId } = job.data;
            observabilityService.logInfo('Processing contract deployment', {
                groupId,
                jobId: job.id,
            });

            const group = await prisma.savingsGroup.findUnique({
                where: { id: groupId },
                include: { members: { include: { user: true } } },
            });

            if (!group) {
                throw new Error(`Group not found for deployment: ${groupId}`);
            }

            // Update deploymentStatus to DEPLOYING
            await prisma.savingsGroup.update({
                where: { id: groupId },
                data: { deploymentStatus: 'DEPLOYING', deploymentError: null },
            });

            // Find group creator's public key if available
            const creatorMember = group.members.find((m) => m.role === 'CREATOR') || group.members[0];
            let adminPublicKey: string | undefined;

            if (creatorMember?.user?.stellarWallet) {
                try {
                    const walletObj = JSON.parse(creatorMember.user.stellarWallet);
                    adminPublicKey = walletObj.publicKey;
                } catch (e) {
                    observabilityService.logWarning('Could not parse creator stellarWallet', {
                        userId: creatorMember.userId,
                        groupId,
                    });
                }
            }

            try {
                const result = await sorobanService.deployGroupContract({
                    groupId: group.id,
                    name: group.name,
                    contributionAmount: group.contributionAmount.toString(),
                    adminPublicKey,
                });

                // Update group with contract ID and DEPLOYED status
                await prisma.savingsGroup.update({
                    where: { id: groupId },
                    data: {
                        stellarContractId: result.contractId,
                        deploymentStatus: 'DEPLOYED',
                        deploymentError: null,
                    },
                });

                observabilityService.logInfo('Successfully deployed contract', {
                    contractId: result.contractId,
                    groupId,
                });
            } catch (error: any) {
                const errorMessage = error?.message || String(error);
                await prisma.savingsGroup.update({
                    where: { id: groupId },
                    data: {
                        deploymentStatus: 'FAILED',
                        deploymentError: errorMessage,
                    },
                });

                observabilityService.logError('Soroban contract deployment worker job failed', error, {
                    groupId,
                    attemptsMade: job.attemptsMade,
                });

                throw error;
            }
        },
        {
            connection,
            concurrency: 2,
        }
    );

    workerInstance.on('completed', (job) => {
        observabilityService.logInfo('Soroban deployment job completed', {
            jobId: job.id,
        });
    });

    workerInstance.on('failed', (job, err) => {
        observabilityService.logError('Soroban deployment job failed', err, {
            jobId: job?.id,
            attemptsMade: job?.attemptsMade,
        });
    });

    observabilityService.logInfo('Soroban deployment worker started');
}

export async function closeSorobanDeploymentWorker(): Promise<void> {
    if (workerInstance) {
        await workerInstance.close();
        workerInstance = null;
    }
}
