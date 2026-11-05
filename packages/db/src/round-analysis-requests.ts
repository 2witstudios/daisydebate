import { createAppError } from '@daisy/errors';
import { advanceAnalysisWork, analysisWorkSchema } from '@daisy/protocol';
import { and, eq, sql } from 'drizzle-orm';
import type { BoundedTransaction } from './bounded-transaction';
import type { Caller } from './room-command-facts';
import type { RoundAnalysisAccess } from './round-analysis-access';
import {
  lockAnalysisAccounts,
  lockAnalysisEvidence,
  lockAnalysisRound,
} from './round-analysis-authority';
import { readLockedFrozenRoundTranscript } from './frozen-transcript';
import { roundAgentNow } from './round-agent-runs';
import { reserveUsageLocked, type AiAllowanceOptions } from './usage-ledger';
import { roundAnalyses } from './schema/round-analyses';
import { usageReservations } from './schema/usage-reservations';

type Tx = Parameters<Parameters<BoundedTransaction>[0]>[0];

async function requireCapacity(
  tx: Tx,
  actorId: string,
  capacity: number,
  now: Date,
) {
  const [pending] = await tx.execute(sql`select count(*)::integer as total,
    count(*) filter(where p.actor_id=${actorId})::integer as own
    from round_analyses a join round_participants p on p.id=a.round_participant_id
    where a.work->>'kind' in ('queued','leased') and (a.work->>'deadlineAt')::timestamptz>${now}`);
  if (!pending || Number(pending.total) >= capacity || Number(pending.own) > 0)
    throw createAppError('CONFLICT', 'Round analysis capacity unavailable');
}

/** New user intent only. Existing identities are reused without spending or reopening. */
export function createRoundAnalysisRequests(input: {
  readonly run: BoundedTransaction;
  readonly nextId: () => string;
  readonly allowance: AiAllowanceOptions;
  readonly capacity: number;
}) {
  if (
    !Number.isSafeInteger(input.capacity) ||
    input.capacity < 1 ||
    input.capacity > 256
  )
    throw createAppError('VALIDATION');
  return async (request: {
    readonly roundId: string;
    readonly caller: Caller;
    readonly authorize: (access: RoundAnalysisAccess) => boolean;
  }) =>
    input.run(async (tx) => {
      const authority = await lockAnalysisAccounts(tx, request);
      if (!authority.privacy || !authority.account)
        throw createAppError('NOT_FOUND');
      // Account fences precede the feature's capacity lock; no vendor I/O or lock upgrade.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended('round-analysis-capacity',59004))`,
      );
      const access = await lockAnalysisRound(tx, authority.target);
      if (access.round.status !== 'completed' || !request.authorize(access))
        throw createAppError('NOT_FOUND');
      const [row] = await tx
        .select()
        .from(roundAnalyses)
        .where(
          eq(
            roundAnalyses.roundParticipantId,
            authority.target.roundParticipantId,
          ),
        )
        .for('update');
      const work = row ? analysisWorkSchema.parse(row.work) : null;
      // Read/retry authority does not depend on generation evidence or current paid access.
      if (work && work.kind !== 'unrequested') return work;
      await requireCapacity(
        tx,
        authority.account.actorId!,
        input.capacity,
        await roundAgentNow(tx),
      );
      await lockAnalysisEvidence(tx, request.roundId);
      const frozen = await readLockedFrozenRoundTranscript(tx, request.roundId);
      if (
        !frozen?.utterances.length ||
        (row && row.freezeRevision !== frozen.revision)
      )
        throw createAppError('CONFLICT', 'Analysis evidence unavailable');
      const [existing] = await tx
        .select({ id: usageReservations.id })
        .from(usageReservations)
        .where(
          and(
            eq(usageReservations.actorId, authority.account.actorId!),
            eq(usageReservations.roundId, request.roundId),
            eq(usageReservations.kind, 'round_analysis'),
          ),
        );
      if (existing)
        throw createAppError('CONFLICT', 'Analysis identity already admitted');
      const [reservation] = await reserveUsageLocked(tx, {
        account: authority.account,
        request: { kind: 'round_analysis', roundId: request.roundId },
        ...input.allowance,
        nextId: input.nextId,
      });
      if (!reservation) throw createAppError('INVARIANT');
      const decision = advanceAnalysisWork(
        work,
        {
          kind: 'request',
          requestId: input.nextId(),
          evidenceLines: frozen.utterances.length,
        },
        {
          now: reservation.reservedAt.toISOString(),
          authorized: true,
          evidenceAvailable: true,
        },
      );
      if (decision.kind !== 'changed')
        throw createAppError('CONFLICT', 'Analysis request cannot reopen');
      if (row) {
        await tx
          .update(roundAnalyses)
          .set({ work: decision.state })
          .where(eq(roundAnalyses.roundParticipantId, row.roundParticipantId));
      } else {
        await tx.insert(roundAnalyses).values({
          ...authority.target,
          freezeRevision: frozen.revision,
          work: decision.state,
        });
      }
      return decision.state;
    });
}
