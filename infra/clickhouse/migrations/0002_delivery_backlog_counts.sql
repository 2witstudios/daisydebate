-- RT-2.3c-arch1 (PR #473): realtime.delivery.backlog carries four counts
-- (ADR 0019 amendment, 2026-10-27), each a loggableFields `count`, privacy
-- category `none`. Nullable, as every field column, and idempotent.

ALTER TABLE daisy_logs.events ADD COLUMN IF NOT EXISTS retained Nullable(UInt64);
ALTER TABLE daisy_logs.events ADD COLUMN IF NOT EXISTS running Nullable(UInt64);
ALTER TABLE daisy_logs.events ADD COLUMN IF NOT EXISTS topics Nullable(UInt64);
ALTER TABLE daisy_logs.events ADD COLUMN IF NOT EXISTS oldest_age_ms Nullable(UInt64);
