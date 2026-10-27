-- ISSUE-654: an account that claimed a username after beta_access_expand ran
-- but before the claim enrolled it has a human actor and no beta access row.
-- Neither grandfathered nor pending, it was invisible to the operator listing
-- and could never be approved. Each such live account gets a pending signup
-- row, requested when it signed up, and exactly that row's migration event,
-- in one statement. Idempotent: an account that has a row is never touched.
-- The event id is derived from the user id, as in beta_access_expand.
WITH backfilled AS (
  INSERT INTO "account_beta_access" ("user_id", "state", "revision", "requested_at", "provenance")
  SELECT u."id", 'pending', 1, u."created_at", 'signup'
  FROM "users" u
  WHERE u."deleted_at" IS NULL AND u."username" IS NOT NULL
    AND EXISTS (SELECT 1 FROM "actors" a WHERE a."user_id" = u."id" AND a."kind" = 'human')
    AND NOT EXISTS (SELECT 1 FROM "account_beta_access" b WHERE b."user_id" = u."id")
  RETURNING "user_id"
)
INSERT INTO "account_access_events" ("id", "user_id", "command_id", "from_state", "to_state", "revision", "principal")
SELECT 'm' || left(md5('beta_access_claimed_backfill:' || "user_id"), 23), "user_id", NULL, NULL, 'pending', 1, 'migration:beta_access_claimed_backfill'
FROM backfilled;
