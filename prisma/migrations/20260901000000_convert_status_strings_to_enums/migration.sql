-- Convert remaining free-form status strings to enums
-- This migration is designed to fail loudly if any existing row
-- contains a value outside the documented set, rather than coercing it.

-- ------------------------------------------------------------------------------
-- ContributionStatus: PENDING, COMPLETED, FAILED
-- ------------------------------------------------------------------------------
CREATE TYPE "ContributionStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- Fail loudly if any existing row has an undocumented value.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Contribution"
    WHERE status NOT IN ('PENDING', 'COMPLETED', 'FAILED')
  ) THEN
    RAISE EXCEPTION 'Contribution.status contains values outside the ContributionStatus enum';
  END IF;
END $$;

ALTER TABLE "Contribution"
  ALTER COLUMN status TYPE "ContributionStatus"
  USING status::"ContributionStatus",
  ALTER COLUMN status SET DEFAULT 'PENDING';

-- ------------------------------------------------------------------------------
-- PayoutStatus: COMPLETED
-- ------------------------------------------------------------------------------
CREATE TYPE "PayoutStatus" AS ENUM ('COMPLETED');

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Payout"
    WHERE status NOT IN ('COMPLETED')
  ) THEN
    RAISE EXCEPTION 'Payout.status contains values outside the PayoutStatus enum';
  END IF;
END $$;

ALTER TABLE "Payout"
  ALTER COLUMN status TYPE "PayoutStatus"
  USING status::"PayoutStatus";

-- ------------------------------------------------------------------------------
-- PayoutOrderLogReason: REORDER, SKIP_DEFAULT
-- ------------------------------------------------------------------------------
CREATE TYPE "PayoutOrderLogReason" AS ENUM ('REORDER', 'SKIP_DEFAULT');

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "PayoutOrderLog"
    WHERE reason NOT IN ('REORDER', 'SKIP_DEFAULT')
  ) THEN
    RAISE EXCEPTION 'PayoutOrderLog.reason contains values outside the PayoutOrderLogReason enum';
  END IF;
END $$;

ALTER TABLE "PayoutOrderLog"
  ALTER COLUMN reason TYPE "PayoutOrderLogReason"
  USING reason::"PayoutOrderLogReason";

-- -----------------------------------------------------------------------------
-- MemberExitLogType: LEAVE, KICK
-- ------------------------------------------------------------------------------
CREATE TYPE "MemberExitLogType" AS ENUM ('LEAVE', 'KICK');

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "MemberExitLog"
    WHERE type NOT IN ('LEAVE', 'KICK')
  ) THEN
    RAISE EXCEPTION 'MemberExitLog.type contains values outside the MemberExitLogType enum';
  END IF;
END $$;

ALTER TABLE "MemberExitLog"
  ALTER COLUMN type TYPE "MemberExitLogType"
  USING type::"MemberExitLogType";

-- ------------------------------------------------------------------------------
-- SecretAccessLogOperation: SEND, CONTRIBUTE, TRUSTLINE, KEY_ROTATION
-- ------------------------------------------------------------------------------
CREATE TYPE "SecretAccessLogOperation" AS ENUM ('SEND', 'CONTRIBUTE', 'TRUSTLINE', 'KEY_ROTATION');

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "SecretAccessLog"
    WHERE operation NOT IN ('SEND', 'CONTRIBUTE', 'TRUSTLINE', 'KEY_ROTATION')
  ) THEN
    RAISE EXCEPTION 'SecretAccessLog.operation contains values outside the SecretAccessLogOperation enum';
  END IF;
END $$;}