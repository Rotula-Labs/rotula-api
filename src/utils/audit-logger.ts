import { prisma } from '../lib/prisma';

export type SecretOperation = 'SEND' | 'CONTRIBUTE' | 'TRUSTLINE' | 'KEY_ROTATION';


/**
 * Resolve the identity of the authenticated caller for audit purposes.
 *
 * The admin surface is gated by a single shared token, so the only attribution
 * available is the token's label. The actor is derived from the authenticated
 * principal, never from the request body. A server timestamp is appended so the
 * recorded value is always non-empty and traceable, including in failure paths.
 */
export function resolveAuditActor(tokenLabel?: string | null): string {
    const label = typeof tokenLabel === 'string' && tokenLabel.trim().length > 0
        ? tokenLabel.trim()
        : 'admin-token';
    return `${label} (authenticated token, server timestamp: ${new Date().toISOString()})`;
}

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
