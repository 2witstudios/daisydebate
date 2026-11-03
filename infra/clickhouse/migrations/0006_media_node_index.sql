-- round.media.node_health names a LiveKit node by nodeIndex (`count`), its position
-- in the node list, loggableFields, privacy category `none`: a position, no address.
-- Nullable, as every field column, and idempotent.

ALTER TABLE daisy_logs.events ADD COLUMN IF NOT EXISTS node_index Nullable(UInt64);
