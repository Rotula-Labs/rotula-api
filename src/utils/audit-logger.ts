import { prisma } from '../lib/prisma';

export type SecretOperation = 'SEND' | 'CONTRIBUTE' | 'TRUSTLINE' | 'KEY_ROTATION';

export type AuditSeverity = 'low' | 'moderate' | 'high' | 'critical';

export interface DependencyAuditFinding {
    packageName: string;
    severity: AuditSeverity;
    advisoryId?: string;
    summary?: string;
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

export async function logDependencyAudit(
    findings: DependencyAuditFinding[],
    source: 'schedule' | 'manual' = 'schedule'
): Promise<void> {
    if (findings.length === 0) {
        console.info(`Dependency audit (${source}): no advisories found`);
        return;
    }

    const counts = findings.reduce<Record<string, number>>((acc, finding) => {
        acc[finding.severity] = (acc[finding.severity] ?? 0) + 1;
        return acc;
    }, {});

    console.warn(
        `Dependency audit (${source}): ${findings.length} advisory(ies) detected`,
        counts
    );

    for (const finding of findings) {
        console.warn(
            `[${finding.severity}] ${finding.packageName}` +
                (finding.advisoryId ? ` (${finding.advisoryId})` : '') +
                (finding.summary ? `: ${finding.summary}` : '')
        );
    }
}