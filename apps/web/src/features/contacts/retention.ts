import type { ContactsStore } from '@daisy/db/stores/contacts';
import {
  DAY_MS,
  retentionAfter,
  type RetentionTarget,
} from '../../server/retention-target';

export const contactRetentionTargets = (
  database: Pick<
    ContactsStore,
    'purgeExpiredSocialDeclines' | 'purgeExpiredSocialRequests'
  >,
): readonly RetentionTarget[] => [
  /**
   * DEC-251: a decline row stops counting and blocking at its own
   * `expires_at` (the policy window after its last decline), so the cutoff
   * is the run's clock itself.
   */
  retentionAfter('social_declines', 0, (batch) =>
    database.purgeExpiredSocialDeclines(batch),
  ),
  /**
   * DEC-259 (open): the request budget looks back one day at most, so an older
   * request row is never counted again.
   */
  retentionAfter('social_requests', DAY_MS, (batch) =>
    database.purgeExpiredSocialRequests(batch),
  ),
];
