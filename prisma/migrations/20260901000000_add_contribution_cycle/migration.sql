-- Give a contribution an explicit cycle reference.
-- The column is nullable so historical rows remain readable; the
-- cycle-scoped queries fall back to the timestamp window for those rows.

-- Add the cycle column to Contribution.
ALTER TABLE "Contribution"
    ADD COLUMN "cycleId" TEXT;

-- Backfill existing rows from the cycle window that was implicitly
-- used before this migration. A row belongs to a cycle when its creation
-- time falls within that cycle's start/end window for the same group.
-- Pick the latest matching cycle so a row cannot be assigned to two.
UPDATE "Contribution" AS c
SET "cycleId" = (
    SELECT c2."id"
    FROM "Cycle" AS c2
    WHERE c2."groupId" = c."groupId"
      AND c."createdAt" >= c2."startsAt"
      AND c."createdAt" <= c2."endsAt"
    ORDER BY c2."startsAt" DESC
    LIMIT 1
)
WHERE c."cycleId" IS NULL;

-- Index the cycle scoped lookups used by reconciliation and payouts.
CREATE INDEX "Contribution_cycleId_idx" ON "Contribution"("cycleId");

-- Enforce referential integrity for newly assigned cycles.
ALTER TABLE "Contribution"
    ADD CSONTRAINT "Contribution_cycleId_fk"
    FOREIGN KEY ("cycleId") REFERENCES "Cycle"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
