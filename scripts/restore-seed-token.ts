import { createHash } from 'node:crypto';

/**
 * A fresh 256-bit CSPRNG token, generated only to be hashed into a
 * verification row's identifier and then discarded — this repository never
 * stores, logs or reuses the raw value, so nothing in its source or history
 * can ever redeem the row it seeds. Same encoding as the real
 * `generateEmailedLinkToken` (`apps/web/src/features/auth/emailed-link-token.ts`);
 * duplicated here because a root script does not reach into `apps/web/src`
 * for runtime code.
 */
export const randomVerificationToken = (): string =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');

/**
 * The same `<purpose>:<sha3-256(token)>` shape Better Auth's `magicLink`
 * plugin stores a real sign-in link under (`server.ts`'s `storeToken`
 * custom hasher calls the real `emailedLinkIdentifier`) — duplicated here
 * for the same reason as `randomVerificationToken`.
 */
export const emailedLinkIdentifier = (purpose: string, token: string): string =>
  `${purpose}:${createHash('sha3-256').update(token).digest('hex')}`;
