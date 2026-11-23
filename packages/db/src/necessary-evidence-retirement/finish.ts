import { addMs } from '@daisy/clock';
import { eq } from 'drizzle-orm';
import type { z } from 'zod';
import { necessaryEvidence } from '../schema/necessary-evidence';
import { sampleRoundExecutionTime } from '../round-execution-time';
import { leaseTokenDigest } from '../lease';
import type { receipt } from './receipt';
import { lock } from './lock';
import type { Tx } from '../tx';
/** Application calls completion only after actual matching-resource revocation AND material deletion acknowledgement. */
export async function finish(
  tx: Tx,
  input: z.infer<typeof receipt>,
  retryMs: number | null,
) {
  const row = await lock(tx, input.identity.evidenceId);
  const nowIso = await sampleRoundExecutionTime(tx);
  const now = new Date(nowIso);
  if (
    !row ||
    row.state !== 'retiring' ||
    row.retirementReason !== input.reason ||
    row.authorityId !== input.identity.authorityId ||
    row.bindingDigest !== input.identity.bindingDigest ||
    row.executionWorkerId !== input.claim.workerId ||
    row.executionEpoch !== input.claim.executionEpoch ||
    row.leaseDigest !== leaseTokenDigest(input.claim.token) ||
    (retryMs === null &&
      (!row.authorityId || !row.leaseExpiresAt || row.leaseExpiresAt <= now))
  )
    return { kind: 'refused' as const };
  await tx
    .update(necessaryEvidence)
    .set({
      ...(retryMs === null
        ? { state: 'retired' as const }
        : { nextAttemptAt: new Date(addMs(nowIso, retryMs)) }),
      leaseDigest: null,
      leaseExpiresAt: null,
    })
    .where(eq(necessaryEvidence.id, row.id));
  return retryMs === null
    ? { kind: 'retired' as const }
    : { kind: 'retry' as const };
}
