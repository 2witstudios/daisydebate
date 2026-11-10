import { createHash } from 'node:crypto';
import {
  isEmailedNotificationKind,
  type EmailedNotificationKind,
} from '@daisy/protocol';
import { deriveSubkey } from '../../mail/recipient-key';

/**
 * The unsubscribe subkey, derived from `RECIPIENT_HASH_SECRET` under its own
 * label, so it never doubles as the recipient-hash subkey (ADR 0044).
 */
export const deriveUnsubscribeSubkey = (secret: string): string =>
  deriveSubkey(secret, 'notification-unsubscribe');

const digest = (value: string) =>
  createHash('sha3-256').update(value).digest('hex');

/** The keyed token an email's unsubscribe link carries for one member and kind. */
export const unsubscribeToken = (
  subkey: string,
  userId: string,
  kind: EmailedNotificationKind,
): string => digest(`${subkey}\0${userId}\0${kind}`);

/** One member's one-kind opt-out, as a link it names. */
export type Unsubscribe = {
  readonly userId: string;
  readonly kind: EmailedNotificationKind;
};

/**
 * The link's facts when its token is the one this key made for them, else
 * null. Both tokens are SHA3-hashed before they are compared, so the
 * comparison leaks nothing about the expected token (timing-safe rule).
 */
export const verifyUnsubscribe = (
  subkey: string,
  input: {
    readonly userId: unknown;
    readonly kind: unknown;
    readonly token: unknown;
  },
): Unsubscribe | null => {
  const { userId, kind, token } = input;
  if (
    typeof userId !== 'string' ||
    !/^[a-z0-9]{24}$/.test(userId) ||
    typeof kind !== 'string' ||
    !isEmailedNotificationKind(kind) ||
    typeof token !== 'string' ||
    token.length > 128
  )
    return null;
  return digest(unsubscribeToken(subkey, userId, kind)) === digest(token)
    ? { userId, kind }
    : null;
};

/** The unsubscribe page's address for one member and kind. */
export const unsubscribeUrl = (
  appUrl: string,
  subkey: string,
  { userId, kind }: Unsubscribe,
): string => {
  const url = new URL('/notifications/unsubscribe', appUrl);
  url.searchParams.set('u', userId);
  url.searchParams.set('k', kind);
  url.searchParams.set('t', unsubscribeToken(subkey, userId, kind));
  return url.toString();
};
