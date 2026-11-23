import { sql } from 'drizzle-orm';
import { sha3Hex } from '@daisy/digest';
import { createAppError } from '@daisy/errors';

/**
 * A worker lease as it is stored: a whole-millisecond duration from now, a
 * SHA3-256 digest of the bearer token (never the token) and a PostgreSQL
 * integer fencing epoch. Every leased worker table holds these columns.
 */

/** Worker leases are whole milliseconds from 1ms to one minute. */
export function requireLeaseMs(leaseMs: number): void {
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1 || leaseMs > 60000)
    throw createAppError('VALIDATION');
}

/** A lease expiry `leaseMs` after the database's own clock. */
export const leaseExpiresIn = (leaseMs: number) =>
  sql`clock_timestamp() + ${leaseMs} * interval '1 millisecond'`;

/** Fencing epochs are PostgreSQL integers; exhaustion refuses rather than wraps. */
export function nextEpoch(current: number, exhausted: string): number {
  const epoch = current + 1;
  if (epoch > 2147483647) throw createAppError('CONFLICT', exhausted);
  return epoch;
}

/** The stored digest of a lease bearer token; a malformed token never authorizes. */
export function leaseTokenDigest(token: string) {
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(token))
    throw createAppError('AUTHORIZATION');
  return sha3Hex(token);
}

/** Both sides are SHA3-256 digests, so a plain comparison leaks no secret timing. */
export function requireLeaseToken(token: string, digest: string) {
  if (!/^[a-f0-9]{64}$/.test(digest) || leaseTokenDigest(token) !== digest)
    throw createAppError('AUTHORIZATION');
}
