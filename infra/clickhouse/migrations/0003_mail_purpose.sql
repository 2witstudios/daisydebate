-- ISSUE-780 (PR #485): mail.* events carry `purpose` (auth | beta-access), a
-- loggableFields `code`, privacy category `none`. Nullable, as every field
-- column, and idempotent.

ALTER TABLE daisy_logs.events ADD COLUMN IF NOT EXISTS purpose Nullable(String);
