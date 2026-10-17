-- Declare the on-delete behaviour for the group relations.
--
-- Operational rows (GroupMember, Payout) belong to the group and have no
-- meaning without it, so they cascade with the group.
-- Audit rows (PayoutOrderLog, MemberExitLog) are append-only and must survive
-- the group they describe, so their group reference is nullable and is set
-- to NULL on delete.

-- Operational rows: cascade.
ALTER TABLE "GroupMember" DROP CONSTRAINT IF EXISTS "GroupMember_groupId_fkey";
ALTER TABLE "GroupMember"
  ADD CONSTRAINT "GroupMember_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "SavingsGroup"("id")
  ON DELETE CASCADE;

ALTER TABLE "Payout" DROP CONSTRAINT IF EXISTS "Payout_groupId_fkey";
ALTER TABLE "Payout"
  ADD CONSTRAINT "Payout_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "SavingsGroup"("id")
  ON DELETE CASCADE;

-- Audit rows: group reference is nullable and set to NULL on delete.
ALTER TABLE "PayoutOrderLog" ALTER COLUMN "groupId" DROP NOT NULL;
ALTER TABLE "PayoutOrderLog" DROP CONSTRAINT IF EXISTS "PayoutOrderLog_groupId_fkey";
ALTER TABLE "PayoutOrderLog"
  ADD CONSTRAINT "PayoutOrderLog_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "SavingsGroup"("id")
  ON DELETE SET NULL;

ALTER TABLE "MemberExitLog" ALTER COLUMN "groupId" DROP NOT NULL;
ALTER TABLE "MemberExitLog" DROP CONSTRAINT IF EXISTS "MemberExitLog_groupId_fkey";
ALTER TABLE "MemberExitLog"
  ADD CONSTRAINT "MemberExitLog_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "SavingsGroup"("id")
  ON DELETE SET NULL;
