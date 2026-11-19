import { createAppError } from '@daisy/errors';
import { sampleRoundExecutionTime } from '../round-execution-time';
import { lock } from './lock';
import { claimDigest, type Claim, type Policy } from './policy';
import type { Tx } from '../tx';
/** Every effect rechecks its own current claim and original receipt expiry after relevant lock waits. */
export async function current(tx: Tx, input: Claim, options: Policy) {
  const owned = await lock(tx, input.contextId, input.roundId);
  const now = new Date(await sampleRoundExecutionTime(tx)),
    row = owned.context;
  if (
    row.model !== options.model ||
    row.policyDigest !== options.policyDigest ||
    row.status !== 'leased' ||
    row.workerId !== input.claim.workerId ||
    row.claimEpoch !== input.claim.epoch ||
    row.leaseDigest !== claimDigest(input.claim.token) ||
    !row.leaseExpiresAt ||
    row.leaseExpiresAt <= now ||
    owned.members.some(
      (unit) =>
        unit.state !== 'retained' ||
        !unit.payloadAcceptedAt ||
        !unit.expiresAt ||
        unit.expiresAt <= now,
    )
  )
    throw createAppError('CONFLICT', 'Recognition execution is stale');
  return { ...owned, now };
}
