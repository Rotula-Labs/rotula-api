import { PrismaClient, Prisma } from '@prisma/client';
import { scheduleGroupCycle, removeGroupCycle } from '../queue/contribution-scheduler.queue';
import { enqueueContractDeployment } from '../queue/soroban-deployment.queue';

const prisma = new PrismaClient();

export class GroupService {
    /**
     * Validates a contribution amount at the service boundary — the last line
     * of defence before a value reaches the database or the blockchain.
     *
     * Throws with a descriptive message so callers can surface it to the user.
     */
    private static validateAmount(amount: string | Prisma.Decimal): void {
        const numericValue = typeof amount === 'string' ? parseFloat(amount) : Number(amount);
        if (isNaN(numericValue) || numericValue <= 0) {
            throw new Error('Contribution amount must be a positive number greater than zero.');
        }
        if (typeof amount === 'string') {
            const decimalPart = amount.includes('.') ? amount.split('.')[1] : '';
            if (decimalPart.length > 7) {
                throw new Error('Amount cannot have more than 7 decimal places.');
            }
        }
        if (numericValue > 1_000_000) {
            throw new Error('Amount exceeds the maximum allowed (1,000,000 XLM).');
        }
    }

    public async createGroup(userId: string, name: string, amount: string | Prisma.Decimal, frequency: string) {
        GroupService.validateAmount(amount);
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

    /**
     * Deletes a savings group and its operational children.
     *
     * Delete policy (declared in prisma/schema.prisma):
     *  - GroupMember:  Cascade  — a membership has no meaning without its group.
     *  - Payout:       Cascade  — a payout belongs to the group and is meaningless alone.
     *  - PayoutOrderLog: SetNull — append-only audit record; survives the group (groupId nullable).
     *  - MemberExitLog:  SetNull — append-only audit record; survives the group (groupId nullable).
     *
     * The audit records are detached (groupId set to null) rather than removed so the
     * history of what happened is preserved even after the group itself is gone.
     */
    public async deleteGroup(groupId: string) {
        const group = await prisma.savingsGroup.findUnique({ where: { id: groupId } });
        if (group) {
            await removeGroupCycle(group.id, group.contributionFrequency);
            // Operational rows (GroupMember, Payout) are removed by the database via
            // ON DELETE CASCADE; audit rows (PayoutOrderLog, MemberExitLog) are
            // detached via ON DELETE SET NULL. No manual cleanup is required here —
            // the schema is the single source of truth for the delete policy.
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
        GroupService.validateAmount(amount);
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
