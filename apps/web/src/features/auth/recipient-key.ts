import { createHash } from 'node:crypto';

/** The one place an email address is trimmed and lowercased before use. */
export const normalizeEmail = (email: string): string =>
  email.trim().toLowerCase();

/**
 * A subkey derived once from `BETTER_AUTH_SECRET`, domain-separated by a
 * fixed label so a leaked recipient key can never double as a leaked
 * `BETTER_AUTH_SECRET` (which also signs sessions and tokens).
 */
export const deriveRecipientSubkey = (secret: string): string =>
  createHash('sha3-256').update(`${secret}\0recipient-key`).digest('hex');

/**
 * The one recipient identity used everywhere a recipient must be compared,
 * stored or bucketed without ever holding the address itself: the delivery
 * ledger's suppression lookups and receipts, the magic-link gate's
 * suppression check, and the rate-limit gate's per-recipient buckets.
 * Keyed by the derived subkey, never the raw `BETTER_AUTH_SECRET` directly.
 */
export const recipientKey = (subkey: string, email: string): string =>
  createHash('sha3-256')
    .update(`${subkey}\0${normalizeEmail(email)}`)
    .digest('hex');
