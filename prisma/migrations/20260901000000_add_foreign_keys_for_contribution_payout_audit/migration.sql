-- Add foreign keys for contribution, payout and audit references.
-- Audit logs (PayoutOrderLog, MemberExitLog, ReconciliationMismatch) are intentionally
-- left unconstrained so they can outlive the rows they reference.

-- Contribution.groupId -> SavingsGroup.id
-- Payout.recipientId -> User.id
-- on Delete Restrict matches the existing group relations.

ALTER TABLE "Contribution"
    ADD CONSTRAINT "Contribution_groupId_fkey"
        FOREIGN KEY ("groupId") REFERENCES "SavingsGroup"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Payout"
    ADD CONSTRAINT "Payout_recipientId_fkey"
        FOREIGN KEY ("recipientId") REFERENCES "User"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;
