-- FLOOR-2: round.media.floor_moved and the lane and hold gauges. `count` and `code`
-- values in loggableFields, privacy category `none`: no personal data.
-- Nullable, as every field column, and idempotent.

ALTER TABLE daisy_logs.events ADD COLUMN IF NOT EXISTS lane Nullable(String);
ALTER TABLE daisy_logs.events ADD COLUMN IF NOT EXISTS mover Nullable(String);
ALTER TABLE daisy_logs.events ADD COLUMN IF NOT EXISTS due_at_ms Nullable(UInt64);
ALTER TABLE daisy_logs.events ADD COLUMN IF NOT EXISTS applied_at_ms Nullable(UInt64);
ALTER TABLE daisy_logs.events ADD COLUMN IF NOT EXISTS vendor_calls Nullable(UInt64);
ALTER TABLE daisy_logs.events ADD COLUMN IF NOT EXISTS vendor_ms Nullable(UInt64);
ALTER TABLE daisy_logs.events ADD COLUMN IF NOT EXISTS vendor_calls_outside_passes Nullable(UInt64);
ALTER TABLE daisy_logs.events ADD COLUMN IF NOT EXISTS permission_writes Nullable(UInt64);
ALTER TABLE daisy_logs.events ADD COLUMN IF NOT EXISTS connections Nullable(UInt64);
ALTER TABLE daisy_logs.events ADD COLUMN IF NOT EXISTS samples Nullable(UInt64);
ALTER TABLE daisy_logs.events ADD COLUMN IF NOT EXISTS active_sum Nullable(UInt64);
ALTER TABLE daisy_logs.events ADD COLUMN IF NOT EXISTS active_max Nullable(UInt64);
ALTER TABLE daisy_logs.events ADD COLUMN IF NOT EXISTS waiting_sum Nullable(UInt64);
ALTER TABLE daisy_logs.events ADD COLUMN IF NOT EXISTS waiting_max Nullable(UInt64);
ALTER TABLE daisy_logs.events ADD COLUMN IF NOT EXISTS holds Nullable(UInt64);
ALTER TABLE daisy_logs.events ADD COLUMN IF NOT EXISTS max_ms Nullable(UInt64);
ALTER TABLE daisy_logs.events ADD COLUMN IF NOT EXISTS p95_ms Nullable(UInt64);
