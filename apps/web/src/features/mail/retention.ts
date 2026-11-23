import type { MailStore } from '@daisy/db/stores/mail';
import {
  DAY_MS,
  retentionAfter,
  type RetentionTarget,
} from '../../server/retention-target';

export const deliveryRetentionTargets = (
  database: Pick<
    MailStore,
    'purgeExpiredEmailDeliveryEvents' | 'purgeExpiredEmailDeliveries'
  >,
): readonly RetentionTarget[] => [
  /** ADR 0025: webhook dedupe rows are kept 30 days after receipt. */
  retentionAfter('email_delivery_event', 30 * DAY_MS, (batch) =>
    database.purgeExpiredEmailDeliveryEvents(batch),
  ),
  /**
   * ADR 0025: delivery diagnostics are kept 30 days after their last
   * status change. Suppressions are never pruned.
   */
  retentionAfter('email_delivery', 30 * DAY_MS, (batch) =>
    database.purgeExpiredEmailDeliveries(batch),
  ),
];

/** ADR 0075: sent, failed and cancelled mail intents are kept 30 days. */
export const mailIntentRetentionTarget = (
  database: Pick<MailStore, 'purgeExpiredMailIntents'>,
): RetentionTarget =>
  retentionAfter('mail_intents', 30 * DAY_MS, (batch) =>
    database.purgeExpiredMailIntents(batch),
  );
