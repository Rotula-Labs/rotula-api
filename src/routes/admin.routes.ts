import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { keyRotationQueue } from '../queue/key-rotation.queue';
import { z } from 'zod';

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
 * Returns a bounded page of unresolved ReconciliationMismatch records grouped
 * by groupId, ordered by most recent detection first, along with the total
 * count of unresolved mismatches.
 *
 * Query params:
 *   - limit: page size (default 100, max 500)
 *   - cursor: opaque cursor from a previous response's `nextCursor`
 */
router.get('/reconciliation/status', async (req, res) => {
    try {
        const querySchema = z.object({
            limit: z.coerce.number().int().min(1).max(500).default(100),
            cursor: z.string().optional(),
        });
        const parsed = querySchema.safeParse(req.query);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Invalid query parameters' });
        }
        const { limit, cursor } = parsed.data;

        const where = { resolvedAt: null };

        const mismatches = await prisma.reconciliationMismatch.findMany({
            where,
            orderBy: { detectedAt: 'desc' },
            take: limit,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });

        const totalUnresolved = await prisma.reconciliationMismatch.count({ where });

        // Group by groupId for easier consumption
        const byGroup: Record<string, typeof mismatches> = {};
        for (const m of mismatches) {
            if (!byGroup[m.groupId]) byGroup[m.groupId] = [];
            byGroup[m.groupId].push(m);
        }

        const nextCursor =
            mismatches.length === limit ? mismatches[mismatches.length - 1].id : null;

        return res.json({
            totalUnresolved,
            pageSize: limit,
            nextCursor,
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
