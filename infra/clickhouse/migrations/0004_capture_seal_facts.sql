-- ISSUE-952 (PR #558): media.capture.sealed and media.capture.token_deferred
-- carry roundId and sessionId (`id`) and windows and captureStartMs (`count`),
-- all loggableFields, privacy category `none`: identifiers and counts, no text.
-- Nullable, as every field column, and idempotent.

ALTER TABLE daisy_logs.events ADD COLUMN IF NOT EXISTS round_id Nullable(String);
ALTER TABLE daisy_logs.events ADD COLUMN IF NOT EXISTS session_id Nullable(String);
ALTER TABLE daisy_logs.events ADD COLUMN IF NOT EXISTS windows Nullable(UInt64);
ALTER TABLE daisy_logs.events ADD COLUMN IF NOT EXISTS capture_start_ms Nullable(UInt64);
