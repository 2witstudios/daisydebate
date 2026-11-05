import { createAppError } from '@daisy/errors';
import {
  analysisRequest,
  analysisWorkBounds,
  analysisWorkSchema,
  advanceAnalysisWork,
  roundAnalysisReportSchema,
  type AnalysisCall,
  type AnalysisWorkEvent,
  type RoundAnalysisReport,
} from '@daisy/protocol';
import { eq, sql } from 'drizzle-orm';
import type { BoundedTransaction } from './bounded-transaction';
import { agentLeaseDigest } from './round-agent-lease';
import {
  lockAnalysisAccounts,
  lockAnalysisEvidence,
  lockAnalysisRound,
  type AnalysisSeat,
} from './round-analysis-authority';
import { readDatabaseTime } from './database-clock';
import { roundAnalyses } from './schema/round-analyses';
import {
  countAnalysisDispatch,
  settleAnalysisUsage,
} from './round-analysis-accounting';
import { readAnalysisInput } from './round-analysis-input';
import type { AllowanceAccountPolicy } from './usage-ledger';

type Tx = Parameters<Parameters<BoundedTransaction>[0]>[0];
export type RoundAnalysisSeat = AnalysisSeat;
type WorkContext = NonNullable<Awaited<ReturnType<typeof readWork>>>;
async function readWork(
  tx: Tx,
  seat: AnalysisSeat,
  accountEligible: AllowanceAccountPolicy,
) {
  const authority = await lockAnalysisAccounts(tx, seat);
  const access = await lockAnalysisRound(tx, seat);
  const [row] = await tx
    .select()
    .from(roundAnalyses)
    .where(eq(roundAnalyses.roundParticipantId, seat.roundParticipantId))
    .for('update');
  if (!row) return null;
  if (row.roundId !== seat.roundId) throw createAppError('NOT_FOUND');
  return {
    row,
    access,
    work: analysisWorkSchema.parse(row.work),
    erased: authority.account?.erased ?? true,
    authorized:
      authority.privacy &&
      access.round.status === 'completed' &&
      accountEligible(authority.account),
  };
}
async function evidenceAvailable(tx: Tx, context: WorkContext) {
  const request = analysisRequest(context.work);
  if (!context.authorized || !request) return false;
  await lockAnalysisEvidence(tx, context.row.roundId);
  const [facts] = await tx.execute(sql`select z.revision,
    (select count(*)::integer from utterances where round_id=${context.row.roundId}) as lines
    from round_transcript_freezes z where z.round_id=${context.row.roundId}`);
  return (
    facts?.revision === context.row.freezeRevision &&
    facts.lines === request.evidenceLines
  );
}
async function apply(
  tx: Tx,
  context: WorkContext,
  event: AnalysisWorkEvent,
  evidence: boolean,
) {
  // The clock follows account, Round, work and evidence locks and their reads.
  const now = (await readDatabaseTime(tx)).toISOString();
  const decision = advanceAnalysisWork(context.work, event, {
    now,
    authorized: context.authorized,
    evidenceAvailable: evidence,
  });
  if (decision.kind === 'changed') {
    await tx
      .update(roundAnalyses)
      .set({ work: decision.state })
      .where(
        eq(roundAnalyses.roundParticipantId, context.row.roundParticipantId),
      );
    await settleAnalysisUsage(tx, {
      ...context.row,
      actorId: context.access.seat.actorId,
      erased: context.erased,
      work: decision.state,
    });
  }
  return decision;
}

/** Requested work only; no automatic Round discovery or Round-age eligibility window. */
export function createRoundAnalysisJobs(input: {
  readonly run: BoundedTransaction;
  readonly nextToken: () => string;
  readonly nextId: () => string;
  readonly leaseMs: number;
  readonly model: string;
  readonly accountEligible: AllowanceAccountPolicy;
}) {
  if (
    !Number.isSafeInteger(input.leaseMs) ||
    input.leaseMs < 1 ||
    input.leaseMs > analysisWorkBounds.leaseMs ||
    !input.model.trim()
  )
    throw createAppError('VALIDATION');
  let after: { requestedAt: string; seatId: string } | null = null;
  return {
    scan: (limit: number) => {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 64)
        throw createAppError('VALIDATION');
      return input.run(async (tx) => {
        const rows =
          (await tx.execute(sql`select round_id as "roundId",round_participant_id as "roundParticipantId",coalesce(work->>'requestedAt',work->'request'->>'requestedAt') as "requestedAt"
          from round_analyses a where (work->>'kind'='queued' or (work->>'kind'='leased' and (work->'lease'->>'expiresAt')::timestamptz<=clock_timestamp()) or (work->>'kind' in ('purged','failed','succeeded') and exists (select 1 from usage_reservations u join round_participants p on p.actor_id=u.actor_id and p.round_id=u.round_id where p.id=a.round_participant_id and u.kind='round_analysis' and u.state->>'kind' in ('reserved','dispatched'))))
          and (${after === null} or (coalesce(work->>'requestedAt',work->'request'->>'requestedAt'), round_participant_id)>(${after?.requestedAt ?? ''},${after?.seatId ?? ''}))
          order by coalesce(work->>'requestedAt',work->'request'->>'requestedAt'),round_participant_id limit ${limit}`)) as unknown as (AnalysisSeat & {
            requestedAt: string;
          })[];
        const last = rows.at(-1);
        after =
          rows.length === limit && last
            ? { requestedAt: last.requestedAt, seatId: last.roundParticipantId }
            : null;
        return rows.map(({ roundId, roundParticipantId }) => ({
          roundId,
          roundParticipantId,
        }));
      });
    },
    claim: (seat: AnalysisSeat) =>
      input.run(async (tx) => {
        const context = await readWork(tx, seat, input.accountEligible);
        if (!context) return null;
        await settleAnalysisUsage(tx, {
          ...context.row,
          actorId: context.access.seat.actorId,
          erased: context.erased,
          work: context.work,
        });
        const evidence = await evidenceAvailable(tx, context);
        const prepared = evidence
          ? await readAnalysisInput(tx, seat, context.access)
          : null;
        const now = await readDatabaseTime(tx);
        const request = analysisRequest(context.work);
        if (!request) return null;
        const token = input.nextToken();
        const callId = input.nextId();
        const decision = await apply(
          tx,
          context,
          {
            kind: 'claim',
            lease: {
              callId,
              tokenDigest: agentLeaseDigest(token),
              model: input.model,
              expiresAt: new Date(
                Math.min(
                  now.getTime() + input.leaseMs,
                  Date.parse(request.deadlineAt),
                ),
              ).toISOString(),
            },
          },
          evidence,
        );
        if (decision.kind !== 'changed' || decision.state.kind !== 'leased')
          return null;
        if (!prepared)
          throw createAppError('INVARIANT', 'Claim requires prepared evidence');
        return { ...prepared, token, callId, model: input.model };
      }),
    dispatch: (seat: AnalysisSeat, callId: string, token: string) =>
      input.run(async (tx) => {
        const context = await readWork(tx, seat, input.accountEligible);
        if (!context) return null;
        const evidence = await evidenceAvailable(tx, context);
        if (!evidence) {
          await apply(
            tx,
            context,
            { kind: 'retry', callId, tokenDigest: agentLeaseDigest(token) },
            false,
          );
          return null;
        }
        const decision = await apply(
          tx,
          context,
          { kind: 'dispatch', callId, tokenDigest: agentLeaseDigest(token) },
          true,
        );
        if (decision.kind !== 'changed' || decision.state.kind !== 'leased')
          return null;
        await countAnalysisDispatch(tx, {
          ...seat,
          actorId: context.access.seat.actorId,
          erased: context.erased,
          work: decision.state,
          before: decision.state.lease.expiresAt,
        });
        return true;
      }),
    observe: (
      seat: AnalysisSeat,
      callId: string,
      token: string,
      outcome: Exclude<AnalysisCall['outcome'], { kind: 'unknown' }>,
    ) =>
      input.run(async (tx) => {
        const context = await readWork(tx, seat, input.accountEligible);
        if (!context) return null;
        return apply(
          tx,
          context,
          {
            kind: 'observe',
            callId,
            tokenDigest: agentLeaseDigest(token),
            outcome,
          },
          false,
        );
      }),
    complete: (
      seat: AnalysisSeat,
      callId: string,
      token: string,
      report: RoundAnalysisReport,
    ) => {
      const parsed = roundAnalysisReportSchema.safeParse(report);
      if (!parsed.success) throw createAppError('VALIDATION');
      return input.run(async (tx) => {
        const context = await readWork(tx, seat, input.accountEligible);
        if (!context) throw createAppError('CONFLICT');
        const evidence = await evidenceAvailable(tx, context);
        const decision = await apply(
          tx,
          context,
          {
            kind: 'publish',
            callId,
            tokenDigest: agentLeaseDigest(token),
            report: parsed.data,
          },
          evidence,
        );
        if (decision.kind !== 'changed')
          throw createAppError('CONFLICT', 'Round analysis authority changed');
      });
    },
    retry: (seat: AnalysisSeat, callId: string, token: string) =>
      input.run(async (tx) => {
        const context = await readWork(tx, seat, input.accountEligible);
        if (!context) return null;
        const evidence = await evidenceAvailable(tx, context);
        return apply(
          tx,
          context,
          { kind: 'retry', callId, tokenDigest: agentLeaseDigest(token) },
          evidence,
        );
      }),
  };
}
