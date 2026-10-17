-- Guard against duplicate contributions for the same member and cycle.
-- The contract is not the ledge we query, so the database must refuse the duplicate.

-- Remove any pre-existing duplicates so the unique index can be created.
-- Keep the most recently written row for each (userId, groupId, cycle) tuple.
DELETE FROM "contribution" a
USING "contribution" b
WHERE a.user_id = b.user_id
AND a.group_id = b.group_id
AND a.cycle = b.cycle
AND a.id < b.id;

-- Enforce one contribution per member per cycle.
CREATE UNIQUE INDEX "contribution_user_id_group_id_cycle_key"
ON "contribution" ("user_id", "group_id", "cycle");
