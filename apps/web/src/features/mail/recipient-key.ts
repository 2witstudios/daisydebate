import { sha3Hex } from '@daisy/digest';

import { normalizeEmail } from '@daisy/protocol/email';
import { deriveSubkey } from '../../server/subkey';
export { normalizeEmail } from '@daisy/protocol/email';

/**
 * Keyed by `RECIPIENT_HASH_SECRET`, never `BETTER_AUTH_SECRET` (ADR 0044,
 * ISSUE-141): the session-signing secret is expected to rotate, and a
 * rotation must never desynchronize the suppression ledger or the
 * per-recipient rate-limit buckets from the hashes already stored under
 * them.
 */
export const deriveRecipientSubkey = (secret: string): string =>
  deriveSubkey(secret, 'recipient-key');

/**
 * The one recipient identity used everywhere a recipient must be compared,
 * stored or bucketed without ever holding the address itself: the delivery
 * ledger's suppression lookups and receipts, the magic-link gate's
 * suppression check, and the rate-limit gate's per-recipient buckets.
 * Keyed by the derived subkey, never a raw secret directly.
 */
export const recipientKey = (subkey: string, email: string): string =>
  sha3Hex(`${subkey}\0${normalizeEmail(email)}`);
