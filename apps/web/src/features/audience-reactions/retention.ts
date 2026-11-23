import { type AudienceReactionsStore } from '@daisy/db/stores/audience-reactions';
import {
  DAY_MS,
  retentionAfter,
  type RetentionTarget,
} from '../../server/retention-target';

/** Audience reactions go 180 days after posting, matching transcript retention (point guard ruling 2026-11-03). */
export const audienceReactionRetentionTarget = (
  database: Pick<AudienceReactionsStore, 'purgeExpiredAudienceReactions'>,
): RetentionTarget =>
  retentionAfter(
    'audience_reactions',
    180 * DAY_MS,
    (batch) => database.purgeExpiredAudienceReactions(batch),
    { batchSize: 1000 },
  );
