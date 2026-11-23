import type { RoundAnalysisStore } from '@daisy/db/stores/round-analysis';
import {
  DAY_MS,
  retentionAfter,
  type RetentionTarget,
} from '../../server/retention-target';

/** Round analyses keep the same 180-day window as the transcripts they read. */
export const roundAnalysisRetentionTarget = (
  database: Pick<RoundAnalysisStore, 'purgeExpiredRoundAnalyses'>,
): RetentionTarget =>
  retentionAfter('round_analyses', 180 * DAY_MS, (batch) =>
    database.purgeExpiredRoundAnalyses(batch),
  );
