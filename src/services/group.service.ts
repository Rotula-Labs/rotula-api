import { PrismaClient, Prisma } from '@prisma/client';
import { scheduleGroupCycle, removeGroupCycle } from '../queue/contribution-scheduler.queue';
import { enqueueContractDeployment } from '../queue/soroban-deployment.queue';

const prisma = new PrismaClient();

export type AmountValidationErrorCode =
    | 'validation.invalid_format'
    | 'validation.zero_amount'
    | 'validation.precision_exceeded'
    | 'validation.exceeds_max';

export class AmountValidationError extends Error {
    constructor(public readonly code: AmountValidationErrorCode) {
        super(code);
        this.name = 'AmountValidationError';
    }
}

export class GroupService {
    /**
     * Shared validator for financial/contribution amounts.
     *
     * Returns null when the amount is valid, or a translation key describing
     * the specific validation failure:
     * - Must match the pattern for a non-negative decimal number (`validation.invalid_format`)
     * - Must be strictly greater than zero (`validation.zero_amount`)
     * - Must not exceed 7 decimal places (`validation.precision_exceeded`)
     * - Must not exceed 1,000,000 XLM (`validation.exceeds_max`)
     */
    public static validateAmount(amount: string | Prisma.Decimal): AmountValidationErrorCode | null {
        const amountStr = typeof amount === 'string' ? amount : String(amount);
        if (!/^\d+(\.\d+)?$/.test(amountStr)) {
            return 'validation.invalid_format';
        }
        const value = parseFloat(amountStr);
        if (isNaN(value) || value <= 0) {
            return 'validation.zero_amount';
        }
        const decimalPart = amountStr.includes('.') ? amountStr.split('.')[1] : '';
        if (decimalPart.length > 7) {
            return 'validation.precision_exceeded';
        }
        if (value > 1_000_000) {
            return 'validation.exceeds_max';
        }
        return null;
    }

    private static assertValidAmount(amount: string | Prisma.Decimal): void {
        const errorKey = GroupService.validateAmount(amount);
        if (errorKey) {
            throw new AmountValidationError(errorKey);
        }
    }

    public async createGroup(userId: string, name: string, amount: string | Prisma.Decimal, frequency: string) {
        GroupService.assertValidAmount(amount);
        const group = await prisma.savingsGroup.create({
            data: {
                name,
                contributionAmount: amount,
                contributionFrequency: frequency,
                deploymentStatus: 'PENDING',
                members: {
                    create: {
                        userId: userId,
                        role: 'CREATOR'
                    }
                }
            }
        });

        const jobId = await scheduleGroupCycle(group.id, frequency);
        await enqueueContractDeployment(group.id);
        
        if (jobId) {
            return await prisma.savingsGroup.update({
                where: { id: group.id },
                data: { bullMqJobId: jobId }
            });
        }
        
        return group;
    }

    public async deleteGroup(groupId: string) {
        const group = await prisma.savingsGroup.findUnique({ where: { id: groupId } });
        if (group) {
            await removeGroupCycle(group.id, group.contributionFrequency);
            await prisma.savingsGroup.delete({ where: { id: groupId } });
        }
    }

    public async updateGroupFrequency(groupId: string, newFrequency: string) {
        const group = await prisma.savingsGroup.findUnique({ where: { id: groupId } });
        if (!group) throw new Error('Group not found');
        
        // Remove old job
        await removeGroupCycle(group.id, group.contributionFrequency);
        
        // Schedule new job
        const newJobId = await scheduleGroupCycle(group.id, newFrequency);
        
        return await prisma.savingsGroup.update({
            where: { id: groupId },
            data: { 
                contributionFrequency: newFrequency,
                bullMqJobId: newJobId
            }
        });
    }

    public async joinGroup(userId: string, groupId: string) {
        return await prisma.groupMember.create({
            data: {
                userId,
                groupId,
                role: 'MEMBER'
            }
        });
    }

    public async getGroupStatus(userId: string) {
        return await prisma.groupMember.findMany({
            where: { userId, status: { not: 'LEFT' } },
            include: {
                group: {
                    include: { members: { where: { status: { not: 'LEFT' } }, include: { user: true } } }
                }
            }
        });
    }

    public async getMembersByGroup(groupId: string) {
        return await prisma.groupMember.findMany({
            where: { groupId, status: { not: 'LEFT' } },
            include: { user: true }
        });
    }

    public async addContribution(userId: string, groupId: string, amount: string | Prisma.Decimal, txHash: string, status: 'COMPLETED' | 'PENDING' | 'FAILED' = 'COMPLETED') {
        GroupService.assertValidAmount(amount);
        return await prisma.contribution.create({
            data: {
                userId,
                groupId,
                amount,
                transactionHash: txHash,
                status,
            }
        });
    }

    public async getContributionsByUser(userId: string) {
        return await prisma.contribution.findMany({
            where: { userId }
        });
    }

    public async getContributionsByGroup(groupId: string) {
        return await prisma.contribution.findMany({
            where: { groupId }
        });
    }
}
