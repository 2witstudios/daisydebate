import type { Database } from '@daisy/db';
import {
  DAY_MS,
  retentionAfter,
  type RetentionTarget,
} from '../../server/retention-target';

export const judgingRetentionTargets = (
  database: Pick<
    Database,
    'clearExpiredPendingBallots' | 'clearExpiredJudgingStages'
  >,
): readonly RetentionTarget[] => [
  /** DEC-101 and DEC-89 (ISSUE-498): cached AI judging responses are kept 180 days. A cleared response fails its job (DEC-223). */
  retentionAfter('pending_ballots', 180 * DAY_MS, (batch) =>
    database.clearExpiredPendingBallots(batch),
  ),
  /** ADR 0125: judging stage records share the 180-day retention window for AI judging responses. */
  retentionAfter('judging_stages', 180 * DAY_MS, (batch) =>
    database.clearExpiredJudgingStages(batch),
  ),
];
