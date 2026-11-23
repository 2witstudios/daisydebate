import type { FlagsStore } from '@daisy/db/stores/flags';
import {
  DAY_MS,
  retentionAfter,
  type RetentionTarget,
} from '../../server/retention-target';

export const flagRetentionTargets = (
  database: Pick<
    FlagsStore,
    'purgeExpiredFlagOverrides' | 'purgeExpiredFlagEvidence'
  >,
): readonly RetentionTarget[] => [
  retentionAfter('flag_overrides', DAY_MS, (batch) =>
    database.purgeExpiredFlagOverrides(batch),
  ),
  retentionAfter('flag_evidence', 90 * DAY_MS, (batch) =>
    database.purgeExpiredFlagEvidence(batch),
  ),
];
