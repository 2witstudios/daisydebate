import type { Database } from '@daisy/db';
import {
  DAY_MS,
  retentionAfter,
  type RetentionTarget,
} from '../../server/retention-target';

/** Round analyses keep the same 180-day window as the transcripts they read. */
export const roundAnalysisRetentionTarget = (
  database: Pick<Database, 'purgeExpiredRoundAnalyses'>,
): RetentionTarget =>
  retentionAfter('round_analyses', 180 * DAY_MS, (batch) =>
    database.purgeExpiredRoundAnalyses(batch),
  );
