import { createAppError } from '@daisy/errors';
import { sampleRoundExecutionTime } from '../round-execution-time';
import { lock } from './lock';
import { leaseTokenDigest } from '../lease';
import type { Claim, Policy } from './policy';
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
    row.leaseDigest !== leaseTokenDigest(input.claim.token) ||
    !row.leaseExpiresAt ||
    row.leaseExpiresAt <= now
  )
    throw createAppError('CONFLICT', 'Recognition execution is stale');
  const members = owned.members.map((unit) => {
    if (
      unit.state !== 'retained' ||
      !unit.payloadAcceptedAt ||
      !unit.expiresAt ||
      unit.expiresAt <= now
    )
      throw createAppError('CONFLICT', 'Recognition execution is stale');
    return { ...unit, expiresAt: unit.expiresAt };
  });
  return {
    ...owned,
    members,
    now,
    context: {
      ...row,
      model: options.model,
      policyDigest: options.policyDigest,
      leaseExpiresAt: row.leaseExpiresAt,
    },
  };
}
