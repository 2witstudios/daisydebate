-- ISSUE-654 (ADR 0075): an account that claimed its username on an old
-- binary after the BETA-1 expand committed, before the claim path enrolled
-- it, has no beta row: the operator listing never shows it, so it can never
-- be approved. Every live claimed human account without a row gets a
-- pending signup row, requested when it joined, with its migration event.
-- Only the rows inserted here get an event, so a re-run changes nothing.
-- The owner digest belongs to a live claim's window, so none is owed here.
WITH "added" AS (
  INSERT INTO "account_beta_access" ("user_id", "state", "revision", "requested_at", "decided_at", "provenance")
  SELECT u."id", 'pending', 1, u."created_at", NULL, 'signup'
  FROM "users" u
  WHERE u."deleted_at" IS NULL AND u."username" IS NOT NULL
    AND EXISTS (SELECT 1 FROM "actors" a WHERE a."user_id" = u."id" AND a."kind" = 'human')
    AND NOT EXISTS (SELECT 1 FROM "account_beta_access" b WHERE b."user_id" = u."id")
  RETURNING "user_id"
)
INSERT INTO "account_access_events" ("id", "user_id", "command_id", "from_state", "to_state", "revision", "principal")
SELECT 'm' || left(md5('beta_access_backfill_pending:' || "user_id"), 23), "user_id", NULL, NULL, 'pending', 1, 'migration:beta_access_backfill_pending'
FROM "added";
