-- ISSUE-1058: media.capture.session_ended carries silentClips and audibleClips
-- (`count`), loggableFields, privacy category `none`: counts, no text.
-- Nullable, as every field column, and idempotent.

ALTER TABLE daisy_logs.events ADD COLUMN IF NOT EXISTS silent_clips Nullable(UInt64);
ALTER TABLE daisy_logs.events ADD COLUMN IF NOT EXISTS audible_clips Nullable(UInt64);
