-- Billing subscription freshness aggregates: logger `count` fields, category none.
-- Nullable and idempotent like the existing event-field columns; no subject IDs.

ALTER TABLE daisy_logs.events ADD COLUMN IF NOT EXISTS staleness_target_ms Nullable(UInt64);
ALTER TABLE daisy_logs.events ADD COLUMN IF NOT EXISTS scan_started_at_ms Nullable(UInt64);
ALTER TABLE daisy_logs.events ADD COLUMN IF NOT EXISTS sampled_at_ms Nullable(UInt64);
ALTER TABLE daisy_logs.events ADD COLUMN IF NOT EXISTS scan_duration_ms Nullable(UInt64);
ALTER TABLE daisy_logs.events ADD COLUMN IF NOT EXISTS scan_pages Nullable(UInt64);
ALTER TABLE daisy_logs.events ADD COLUMN IF NOT EXISTS scan_budget_ms Nullable(UInt64);
ALTER TABLE daisy_logs.events ADD COLUMN IF NOT EXISTS oldest_revision_request_age_ms Nullable(UInt64);
ALTER TABLE daisy_logs.events ADD COLUMN IF NOT EXISTS oldest_observed_age_ms Nullable(UInt64);
ALTER TABLE daisy_logs.events ADD COLUMN IF NOT EXISTS claimed Nullable(UInt64);
ALTER TABLE daisy_logs.events ADD COLUMN IF NOT EXISTS settled Nullable(UInt64);
ALTER TABLE daisy_logs.events ADD COLUMN IF NOT EXISTS unconfirmed Nullable(UInt64);
ALTER TABLE daisy_logs.events ADD COLUMN IF NOT EXISTS scanned Nullable(UInt64);
