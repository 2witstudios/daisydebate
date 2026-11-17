import { createHash } from 'node:crypto';
import { deriveSubkey } from '../../mail/recipient-key';

/**
 * The unsubscribe subkey, derived from `RECIPIENT_HASH_SECRET` under its own
 * label, so it never doubles as the recipient-hash subkey (ADR 0044).
 */
export const deriveUnsubscribeSubkey = (secret: string): string =>
  deriveSubkey(secret, 'notification-unsubscribe');

const digest = (value: string) =>
  createHash('sha3-256').update(value).digest('hex');

/**
 * What an unsubscribe link does (ADR 0143): stops every notification email
 * for one member. Which kinds Daisy emails is chosen in Settings.
 */
const PURPOSE = 'all-notification-email';

/** The keyed token an email's unsubscribe link carries for one member. */
export const unsubscribeToken = (subkey: string, userId: string): string =>
  digest(`${subkey}\0${userId}\0${PURPOSE}`);

/** One member's opt-out from notification email, as a link names it. */
export type Unsubscribe = { readonly userId: string };

/**
 * The link's member when its token is the one this key made for them, else
 * null. Both tokens are SHA3-hashed before they are compared, so the
 * comparison leaks nothing about the expected token (timing-safe rule).
 */
export const verifyUnsubscribe = (
  subkey: string,
  input: { readonly userId: unknown; readonly token: unknown },
): Unsubscribe | null => {
  const { userId, token } = input;
  if (
    typeof userId !== 'string' ||
    !/^[a-z0-9]{24}$/.test(userId) ||
    typeof token !== 'string' ||
    token.length > 128
  )
    return null;
  return digest(unsubscribeToken(subkey, userId)) === digest(token)
    ? { userId }
    : null;
};

const withToken = (
  url: URL,
  subkey: string,
  { userId }: Unsubscribe,
): string => {
  url.searchParams.set('u', userId);
  url.searchParams.set('t', unsubscribeToken(subkey, userId));
  return url.toString();
};

/** The public unsubscribe page an email links to, for one member. */
export const unsubscribeUrl = (
  appUrl: string,
  subkey: string,
  unsubscribe: Unsubscribe,
): string => withToken(new URL('/unsubscribe', appUrl), subkey, unsubscribe);

/** The one-click endpoint a `List-Unsubscribe` header names (RFC 8058). */
export const oneClickUnsubscribeUrl = (
  appUrl: string,
  subkey: string,
  unsubscribe: Unsubscribe,
): string =>
  withToken(
    new URL('/api/notifications/unsubscribe', appUrl),
    subkey,
    unsubscribe,
  );
