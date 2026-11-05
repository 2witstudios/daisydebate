import { createAppError } from '@daisy/errors';
import type { FlagSnapshot } from '@daisy/protocol/flags';
import { lockFlags } from './flags-lock';
import { readFlagSnapshot, type FlagReadTransaction } from './flags-read';

/** Trusted catalogue closure and a synchronous pure decision, not transaction callbacks. */
export type ReleaseAdmission = {
  readonly keys: readonly string[];
  readonly decide: (snapshot: FlagSnapshot, now: number) => boolean;
};

/**
 * Call after the canonical account fence and other blocking locks, in the
 * READ COMMITTED transaction that inserts the new intent. Persist admittedAt;
 * hold this shared transaction lock through commit, with no external I/O.
 * Already admitted attempts recover through their owner's separate contract.
 */
export async function requireFlagAdmission(
  tx: FlagReadTransaction,
  accountId: string,
  policy: ReleaseAdmission,
): Promise<{ readonly admittedAt: string }> {
  await lockFlags(tx, 'read');
  // A separate statement after lock acquisition sees completed disables and expiry.
  const { snapshot, now } = await readFlagSnapshot(tx, accountId, policy.keys);
  if (policy.decide(snapshot, now) !== true) throw createAppError('NOT_FOUND');
  return { admittedAt: new Date(now).toISOString() };
}
