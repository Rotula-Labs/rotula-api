-- Migration: replace free-form status strings on group member and savings group with enums
-- This migration introduces three Postgres enum types and casts the existing text columns.
-- A data-repair step normalizes any row whose current value falls outside the enum before the cast.

-- 1. Create enum types
CREATE TYPE "GroupMemberRole" AS ENUM ('CREATOR', 'MEMBER');
CREATE TYPE "GroupMemberStatus" AS ENUM ('ACTIVE', 'LEFT');
CREATE TYPE "ContributionFrequency" AS ENUM ('WEEKLY', 'BIWEEKLY', 'MONTHLY');

-- 2. Data repair: normalize unexpected values before casting.
--    Rows outside the enum are mapped to a safe default and logged via a notice.
--    Review the notice output in your deploy logs to identify affected rows.

DO $$
DECLARE
    record RECORD;
    repaired_roles INTEGER := 0;
    repaired_statuses INTEGER := 0;
    repaired_frequencies INTEGER := 0;
BEGIN
    -- Normalize GroupMember.role
    FOR record IN SELECT id, role FROM "GroupMember" WHERE role NOT IN ('CREATOR', 'MEMBER') LOOP
        UPDATE "GroupMember" SET role = CASE WHEN UPPER(COALESCE(record.role AS TEXT)) = 'CREATOR' THEN 'CREATOR' ELSE 'MEMBER' END WHERE id = record.id;
        repaired_roles := repaired_roles + 1;
    END LOOP;

    -- Normalize GroupMember.status
    FOR record IN SELECT id, status FROM "GroupMember" WHERE status NOT IN ('ACTIVE', 'LEFT') LOOP
        UPDATE "GroupMember" SET status = CASE WHEN UPPER(COALESCE(record.status AS TEXT)) = 'LEFT' THEN 'LEFT' ELSE 'ACTIVE' END WHERE id = record.id;
        repaired_statuses := repaired_statuses + 1;
    END LOOP;

    -- Normalize SavingsGroup.contributionFrequency
    FOR record IN SELECT id, "contributionFrequency" FROM "SavingsGroup" WHERE "contributionFrequency" NOT IN ('WEEKLY', 'BIWEEKLY', 'MONTHLY') LOOP
        UPDATE "SavingsGroup" SET "contributionFrequency" = CASE UPPER(COALESCE(record."contributionFrequency" AS TEXT))
            WHEN 'WEEKLY' THEN 'WEEKLY'
            WHEN 'BIWEEKLY' THEN 'BIWEEKLY'
            WHEN 'MONTHLY' THEN 'MONTHLY'
            WHEN 'BIWEEK' THEN 'BIWEEKLY'
            WHEN 'BIWEEKLY' THEN 'BIWEEKLY'
            ELSE 'MONTHLY' END WHERE id = record.id;
        repaired_frequencies := repaired_frequencies + 1;
    END LOOP;

    IF repaired_roles > 0 OR repaired_statuses > 0 OR repaired_frequencies > 0 THEN
        RAISE NOTICE format(
            'Enum migration repaired %s GroupMember.role, %s GroupMember.status, and %s SavingsGroup.contributionFrequency rows.',
            repaired_roles, repaired_statuses, repaired_frequencies
        );
    END IF;
END;$$;

-- 3. Cast the columns to the new enum types.
ALTER TABLE "GroupMember"
    ALTER COLUMN role TYPE "GroupMemberRole" USING role::"GroupMemberRole",
    ALTER COLUMN status TYPE "GroupMemberStatus" USING status::"GroupMemberStatus";

ALTER TABLE "SavingsGroup"
    ALTER COLUMN "contributionFrequency" TYPE "ContributionFrequency" USING "contributionFrequency"::"ContributionFrequency";
