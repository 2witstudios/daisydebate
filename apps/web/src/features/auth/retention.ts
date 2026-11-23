import type { MailStore } from '@daisy/db/stores/mail';
import type { AuthStore, ProvisionalLinkPurposes } from '@daisy/db/stores/auth';
import {
  DAY_MS,
  retentionAfter,
  type RetentionTarget,
} from '../../server/retention-target';

/** AUTH-7.5a: expired rows are kept for a 24-hour grace before deletion. */
export const verificationRetentionTarget = (
  database: Pick<MailStore, 'purgeExpiredVerifications'>,
): RetentionTarget =>
  retentionAfter('verification', DAY_MS, (batch) =>
    database.purgeExpiredVerifications(batch),
  );

/**
 * AUTH-7.5: a session is deleted the instant it is revoked
 * (`revokeOtherSessions`, `revokeSessionUnlessAddressHeld`), so this
 * sweep only ever finds sessions that ran to their own `expires_at` and
 * were never signed out of; it keeps the same 24-hour grace as
 * verification rows.
 */
export const sessionRetentionTarget = (
  database: Pick<AuthStore, 'purgeExpiredSessions'>,
): RetentionTarget =>
  retentionAfter('session', DAY_MS, (batch) =>
    database.purgeExpiredSessions(batch),
  );

// ISSUE-660(b), orchestrator policy: abandoned accounts expire after 24h.
export const provisionalUserRetentionTarget = (
  database: Pick<AuthStore, 'purgeExpiredProvisionalUsers'>,
  provisionalLinks: ProvisionalLinkPurposes,
): RetentionTarget =>
  retentionAfter(
    'provisional_user',
    DAY_MS,
    (batch) =>
      database.purgeExpiredProvisionalUsers({ ...batch, ...provisionalLinks }),
    { batchSize: 50 },
  );
