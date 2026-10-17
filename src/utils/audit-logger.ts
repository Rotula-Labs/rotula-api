import { prisma } from '../lib/prisma';
import type { SecretAccessOperation } from '@prisma/client';

export type SecretOperation = SecretAccessOperation;

export async function logSecretAccess(
    userId: string,
    operation: SecretOperation,
    success: boolean,
    errorMessage?: string
): Promise<void> {
    try {
        await prisma.secretAccessLog.create({
            data: {
                userId,
                operation,
                success,
                errorMessage,
            },
        });
    } catch (e) {
        console.error('Audit log failed:', e);
    }
}
