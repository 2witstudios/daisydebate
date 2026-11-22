import { sha3Hex } from '@daisy/digest';
import { deriveSubkey } from '../mail/recipient-key';

/**
 * "Don't send me release requests" (ADR 0151): the email's link names the
 * address only by its keyed recipient hash, with a keyed token over it, so a
 * link cannot be forged for another address and never carries the address.
 */
export const deriveReleaseStopSubkey = (secret: string): string =>
  deriveSubkey(secret, 'media-release-stop');

const digest = (value: string) => sha3Hex(value);

export const releaseStopToken = (subkey: string, recipientHash: string) =>
  digest(`${subkey}\0${recipientHash}\0media-release-stop`);

/**
 * The recipient hash when the token is the one this key made for it, else
 * null. Both sides are hashed before comparing (timing-safe rule).
 */
export const verifyReleaseStop = (
  subkey: string,
  input: { readonly recipientHash: unknown; readonly token: unknown },
): string | null => {
  const { recipientHash, token } = input;
  if (
    typeof recipientHash !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(recipientHash) ||
    typeof token !== 'string' ||
    token.length > 128
  )
    return null;
  return digest(releaseStopToken(subkey, recipientHash)) === digest(token)
    ? recipientHash
    : null;
};

export const releaseStopPath = (subkey: string, recipientHash: string) =>
  `/release/stop?a=${recipientHash}&t=${releaseStopToken(subkey, recipientHash)}`;
