import type { Database } from '@daisy/db';
import {
  retentionAfter,
  type RetentionTarget,
} from '../../server/retention-target';

/**
 * How long an erased account's sanctions are kept. A proposed value awaiting
 * counsel (DEC-298, COMP-4); this one line changes it, with no migration.
 */
export const MODERATION_RECORD_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;

/** An erased account's sanctions past their proposed retention. */
export const moderationRetentionTarget = (
  database: Pick<Database, 'purgeErasedModeration'>,
): RetentionTarget =>
  retentionAfter(
    'moderation',
    MODERATION_RECORD_RETENTION_MS,
    (batch) => database.purgeErasedModeration(batch),
    { batchSize: 1000, maxBatches: 50 },
  );
