-- ADR 0112: how many Broadcasts a publisher pass failed to publish. A `count` value in
-- loggableFields, privacy category `none`: no personal data.
-- Nullable, as every field column, and idempotent.

ALTER TABLE daisy_logs.events ADD COLUMN IF NOT EXISTS failed Nullable(UInt64);
