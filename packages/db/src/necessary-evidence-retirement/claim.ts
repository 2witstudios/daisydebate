import { eq, sql } from 'drizzle-orm';
import type { BoundedTransactionContext } from '../transaction-context';
import { necessaryEvidence } from '../schema/necessary-evidence';
import { sampleRoundExecutionTime } from '../round-execution-time';
import { evidenceLeaseDigest } from '../necessary-evidence-policy';
import { nextEpoch } from '../lease-policy';
import { select } from './select';
import { lock } from './lock';
import { eligible } from './eligible';
/** Returned only after the owning bounded transaction commits the no-use fence. No external custody here. */
export async function claim(
  tx: BoundedTransactionContext,
  input: { workerId: string; lane: 'attached' | 'detached' },
  options: { leaseMs: number; nextToken: () => string },
) {
  const id = await select(tx, input.lane);
  if (!id) return { kind: 'idle' as const };
  const row = await lock(tx, id);
  if (!row) return { kind: 'idle' as const };
  // Revalidate positive facts after all relevant waits. A competing claim is never overwritten.
  const [due] = (await tx.execute(sql`select
    case when e.state='retiring' then e.retirement_reason
      when exists(select 1 from necessary_evidence_round_fences f where f.round_id=e.original_round_id and f.withdrawn_at is not null)
        or exists(select 1 from necessary_evidence_erasure_requests p where p.actor_id=any(e.original_subject_actor_ids))
      then 'erased' else 'expired' end as reason
    from necessary_evidence e where e.id=${id} and ${eligible}`)) as unknown as {
    reason: 'settled' | 'erased' | 'expired' | 'unreceived';
  }[];
  if (!due) return { kind: 'idle' as const };
  const executionEpoch = nextEpoch(
    row.executionEpoch,
    'Evidence retirement epoch exhausted',
  );
  const token = options.nextToken(),
    leaseDigest = evidenceLeaseDigest(token);
  const now = new Date(await sampleRoundExecutionTime(tx));
  await tx
    .update(necessaryEvidence)
    .set({
      state: 'retiring',
      retirementReason: due.reason,
      reservedBytes: 0,
      ciphertext: null,
      nonce: null,
      tag: null,
      executionWorkerId: input.workerId,
      executionEpoch,
      leaseDigest,
      leaseExpiresAt: new Date(now.getTime() + options.leaseMs),
      lastClaimedAt: now,
    })
    .where(eq(necessaryEvidence.id, id));
  return {
    kind: 'claimed' as const,
    reason: due.reason,
    identity: {
      evidenceId: id,
      bindingDigest: row.bindingDigest,
      authorityId: row.authorityId,
    },
    claim: { workerId: input.workerId, executionEpoch, token },
  };
}
