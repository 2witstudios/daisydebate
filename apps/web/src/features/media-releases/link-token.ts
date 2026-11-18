import { createHash } from 'node:crypto';
import type { ReleaseLinkPurpose } from '@daisy/protocol/media-release';

/**
 * A parent's emailed link (ADR 0019, ADR 0151): 32 CSPRNG bytes, base64url.
 * The server keeps only the purpose-prefixed SHA3-256 digest, so a sign
 * token can never be used as a manage token, and the link carries nothing
 * about the minor or the request.
 */
export const newReleaseLinkToken = (): string =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');

const TOKEN = /^[A-Za-z0-9_-]{43}$/u;

/** Whether a presented value has a token's shape; anything else is never looked up. */
export const isReleaseLinkToken = (value: unknown): value is string =>
  typeof value === 'string' && TOKEN.test(value);

/** The only form of a token the server stores and looks up. */
export const releaseLinkDigest = (
  purpose: ReleaseLinkPurpose,
  token: string,
): string => `${purpose}:${createHash('sha3-256').update(token).digest('hex')}`;

/** The page a link opens: the token rides the query, never a path segment. */
export const releaseLinkPath = (
  purpose: ReleaseLinkPurpose,
  token: string,
): string =>
  `${purpose === 'sign' ? '/release' : '/release/manage'}?t=${encodeURIComponent(token)}`;
