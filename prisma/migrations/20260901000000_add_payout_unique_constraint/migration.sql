-- Ensure a single payout per (group, recipient, cycle).
-- This makes the idempotency invariant the database's job,
-- matching the guard in payout.service.ts and the exit path in group-exit.service.ts.

CREATE UNIQUE INDEX IF NOT EXISTS "payout_groupId_recipientId_cycleNumber_key"
ON "payout" ("groupId", "recipientId", "cycleNumber");
