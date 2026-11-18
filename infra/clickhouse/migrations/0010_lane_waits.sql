-- staging-noise: db.lane.window and db.lane.hold carry `waits`, the holds that
-- queued for their lane. A logger `count` field, privacy category `none`.
-- Nullable and idempotent like the existing event-field columns.

ALTER TABLE daisy_logs.events ADD COLUMN IF NOT EXISTS waits Nullable(UInt64);
