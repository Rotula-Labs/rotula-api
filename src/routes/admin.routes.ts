/**
 * Admin routes — operator documentation lives in Docs/reconciliation.md.
 *
 * All routes below are gated on the `ADMIN_TOKEN` environment variable and
 * require an `Authorization: Bearer <ADMIN_TOKEN>` header. See
 * Docs/reconciliation.md for the reconciliation worker cadence, the meaning
 * of each ReconciliationMismatch column, and the resolution runbook.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { keyRotationQueue } from '../queue/key-rotation.queue';

const router = Router();
const prisma = new PrismaClient();

const adminAuth = (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    const adminToken = process.env.ADMIN_TOKEN;
    
    if (!adminToken || !authHeader || authHeader !== `Bearer ${adminToken}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    next();
};

// POST /admin/key-rotation/start
// Body: none. Response: { message: string, jobId: string } on success,
// 400 if a rotation job is already active or waiting, 401 if unauthorized.
router.use(adminAuth);
router.post('/key-rotation/start', async (req, res) => {
    try {
        const activeJobs = await keyRotationQueue.getActiveCount();
        const waitingJobs = await keyRotationQueue.getWaitingCount();

        if (activeJobs > 0 || waitingJobs > 0) {
            return res.status(400).json({ error: 'A key rotation job is already running or queued.' });
        }

        const job = await keyRotationQueue.add('rotate-keys', {});
        return res.json({ message: 'Key rotation started', jobId: job.id });
    } catch (error) {
        return res.status(500).json({ error: 'Failed to start key rotation' });
    }
});

// GET /admin/key-rotation/status
// Body: none. Response: { status: 'running' | 'idle', metrics: { active,
// waiting, completed, failed } }. 401 if unauthorized.
router.get('/key-rotation/status', async (req, res) => {
    try {
        const activeCount = await keyRotationQueue.getActiveCount();
        const waitingCount = await keyRotationQueue.getWaitingCount();
        const completedCount = await keyRotationQueue.getCompletedCount();
        const failedCount = await keyRotationQueue.getFailedCount();

        return res.json({
            status: activeCount > 0 ? 'running' : 'idle',
            metrics: {
                active: activeCount,
                waiting: waitingCount,
                completed: completedCount,
                failed: failedCount
            }
        });
    } catch (error) {
        return res.status(500).json({ error: 'Failed to get key rotation status' });
    }
});

// ── Reconciliation endpoints ──────────────────────────────────────────────────

/**
 * GET /admin/reconciliation/status
 *
 * Auth: Bearer ADMIN_TOKEN. Body: none.
 * Response: { totalUnresolved: number, groups: [{ groupId, mismatchCount,
 * mismatches: ReconciliationMismatch[] }] }.
 *
 * Returns all unresolved ReconciliationMismatch records grouped by groupId,
 * ordered by most recent detection first.
 */
router.get('/reconciliation/status', async (req, res) => {
    try {
        const mismatches = await prisma.reconciliationMismatch.findMany({
            where: { resolvedAt: null },
            orderBy: { detectedAt: 'desc' },
        });

        // Group by groupId for easier consumption
        const byGroup: Record<string, typeof mismatches> = {};
        for (const m of mismatches) {
            if (!byGroup[m.groupId]) byGroup[m.groupId] = [];
            byGroup[m.groupId].push(m);
        }

        return res.json({
            totalUnresolved: mismatches.length,
            groups: Object.entries(byGroup).map(([groupId, items]) => ({
                groupId,
                mismatchCount: items.length,
                mismatches: items,
            })),
        });
    } catch (error) {
        return res.status(500).json({ error: 'Failed to fetch reconciliation status' });
    }
});

/**
 * PATCH /admin/reconciliation/:id/resolve
 *
 * Auth: Bearer ADMIN_TOKEN.
 * Body: { resolvedBy: string } — required; the admin's userId or identifier.
 * Responses:
 *   200 { message, mismatch } on success
 *   400 { error } when resolvedBy is missing
 *   404 { error } when the mismatch id does not exist
 *   409 { error } when the mismatch is already resolved (resolvedAt set)
 *
 * Marks a single mismatch as resolved after admin investigation.
 * Body: { resolvedBy: string } — the admin's userId or identifier.
 */
router.patch('/reconciliation/:id/resolve', async (req, res) => {
    const { id } = req.params;
    const { resolvedBy } = req.body as { resolvedBy?: string };

    if (!resolvedBy) {
        return res.status(400).json({ error: 'resolvedBy is required' });
    }

    try {
        const mismatch = await prisma.reconciliationMismatch.findUnique({ where: { id } });
        if (!mismatch) {
            return res.status(404).json({ error: 'Mismatch record not found' });
        }
        if (mismatch.resolvedAt) {
            return res.status(409).json({ error: 'Mismatch is already resolved' });
        }

        const updated = await prisma.reconciliationMismatch.update({
            where: { id },
            data: { resolvedAt: new Date(), resolvedBy },
        });

        return res.json({ message: 'Mismatch marked as resolved', mismatch: updated });
    } catch (error) {
        return res.status(500).json({ error: 'Failed to resolve mismatch' });
    }
});

export default router;
