import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { keyRotationQueue } from '../queue/key-rotation.queue';

const router = Router();
const prisma = new PrismaClient();

type AdminRequest = Request & { adminIdentity?: string };

const adminAuth = (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    const adminToken = process.env.ADMIN_TOKEN;
    
    if (!adminToken || !authHeader || authHeader !== `Bearer ${adminToken}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    // Bind the authenticated principal to the request so downstream handlers
    // can derive the actor identity from the token rather than the body.
    (req as AdminRequest).adminIdentity =
        process.env.ADMIN_IDENTITY?.trim() || 'admin-token';
    
    next();
};

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
 * Marks a single mismatch as resolved after admin investigation.
 * The resolver identity is derived from the authenticated caller, not the body.
 */
router.patch('/reconciliation/:id/resolve', async (req, res) => {
    const { id } = req.params;

    // Derive the actor from the authenticated principal. Per-admin identities
    // are not yet available, so we record the authenticated token's label plus
    // a server timestamp. Any `resolvedBy` supplied in the body is ignored.
    const adminIdentity =
        (req as AdminRequest).adminIdentity || 'admin-token';
    const resolvedBy = `${adminIdentity}@${new Date().toISOString()}`;

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
            data: { resolvedAt: new Date(), resolvedBy: resolvedBy || 'unknown-admin' },
        });

        return res.json({ message: 'Mismatch marked as resolved', mismatch: updated });
    } catch (error) {
        return res.status(500).json({ error: 'Failed to resolve mismatch' });
    }
});

export default router;
