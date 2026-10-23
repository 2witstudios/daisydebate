import { and, asc, eq, or, sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import { ballotSchema } from '@daisy/protocol';
import type { BoundedTransactionContext } from './transaction-context';
import type { BoundedTransaction } from './bounded-transaction';
import { agentRuns } from './schema/agent-runs';
import { roundJudgingJobs } from './schema/round-judging-jobs';
import { rounds } from './schema/rounds';
import {
  endLockedRoundAgentRun,
  lockRoundAgentContext,
} from './round-agent-runs';
import {
  assertLockedJudgingLease,
  judgingJobWhere,
  type JudgingScope,
} from './round-judging-context';
import { recordJudgingUsage } from './round-judging-accounting';
import { claimLockedJudgingJob } from './round-judging-claim';
import { submitLockedJudgingResult } from './round-judging-result';
import type { LockedRoundBallotInput } from './round-ballot-operations';
import {
  lockBotAdmission,
  markLockedRoundBotModelCall,
} from './round-bot-admission';
import { requireLeaseMs } from './lease-policy';
import {
  pendingBallotAction,
  requireUndispatched,
} from './round-judging-decisions';
export type { JudgingScope } from './round-judging-context';
/** Paid model calls one judging job may buy over all its leases (ISSUE-461). */
const MAX_JUDGING_CALLS = 2;
/**
 * One paid answer per attempt, a bounded number of attempts (DEC-210's rule
 * for judges): a job that already bought its calls, or whose ballot deadline
 * has passed, buys nothing more. Calls that may have been served count.
 */
async function judgingDispatchEnded(
  tx: BoundedTransactionContext,
  scope: JudgingScope,
) {
  const [facts] = (await tx.execute(sql`select
    (select count(*)::int from agent_runs
      where round_participant_id=${scope.judgeParticipantId} and kind='judging'
        and configuration_snapshot->>'commandId'=${scope.commandId}
        and configuration_snapshot->>'providerOutcome' in ('unknown','received')) as paid,
    (select coalesce(ballot_deadline_at<=clock_timestamp(),false) from rounds
      where id=${scope.roundId}) as late`)) as unknown as {
    paid: number;
    late: boolean;
  }[];
  return facts!.paid >= MAX_JUDGING_CALLS || facts!.late;
}
/** The terminal state: no lease, never rediscovered; DEC-201's deadline completes the Round. */
async function failLockedJudgingJob(
  tx: BoundedTransactionContext,
  scope: JudgingScope,
  runId: string,
) {
  await endLockedRoundAgentRun(tx, runId, scope.judgeParticipantId);
  await tx
    .update(roundJudgingJobs)
    .set({ status: 'failed', leaseTokenDigest: null, leaseExpiresAt: null })
    .where(judgingJobWhere(scope));
}
/** Durable intents use the same injected bounded transaction; no provider I/O occurs under locks. */
export function createRoundJudgingJobs(input: {
  readonly run: BoundedTransaction;
  readonly nextId: () => string;
  readonly nextToken: () => string;
  readonly leaseMs: number;
  readonly model: string;
}) {
  requireLeaseMs(input.leaseMs);
  if (!input.model.trim()) throw createAppError('VALIDATION');
  const withLease = <T>(
    scope: JudgingScope,
    token: string,
    work: (
      tx: BoundedTransactionContext,
      lease: Awaited<ReturnType<typeof assertLockedJudgingLease>> & {
        round: Awaited<ReturnType<typeof lockRoundAgentContext>>['round'];
      },
    ) => T | Promise<T>,
    billable = false,
  ) =>
    input.run(async (tx) => {
      if (billable) await lockBotAdmission(tx);
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${scope.commandId},59002))`,
      );
      const context = await lockRoundAgentContext(
        tx,
        scope.roundId,
        scope.judgeParticipantId,
      );
      if (context.seat.role !== 'judge') throw createAppError('AUTHORIZATION');
      const lease = await assertLockedJudgingLease(tx, scope, token);
      return work(tx, { ...lease, round: context.round });
    });
  return {
    scan: (limit: number) => {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 64)
        throw createAppError('VALIDATION');
      return input.run((tx) =>
        tx
          .select({
            roundId: roundJudgingJobs.roundId,
            judgeParticipantId: roundJudgingJobs.judgeParticipantId,
          })
          .from(roundJudgingJobs)
          .innerJoin(rounds, eq(rounds.id, roundJudgingJobs.roundId))
          .where(
            and(
              eq(rounds.status, 'active'),
              or(
                eq(roundJudgingJobs.status, 'queued'),
                and(
                  eq(roundJudgingJobs.status, 'leased'),
                  sql`${roundJudgingJobs.leaseExpiresAt}<=clock_timestamp()`,
                ),
              ),
            ),
          )
          .orderBy(
            asc(roundJudgingJobs.createdAt),
            asc(roundJudgingJobs.roundId),
            asc(roundJudgingJobs.judgeParticipantId),
          )
          .limit(limit),
      );
    },
    claim: (target: Pick<JudgingScope, 'roundId' | 'judgeParticipantId'>) =>
      input.run((tx) => claimLockedJudgingJob(tx, target, input)),
    submitResult: (
      scope: JudgingScope,
      token: string,
      prepared: LockedRoundBallotInput,
    ) =>
      input.run((tx) => submitLockedJudgingResult(tx, scope, token, prepared)),
    verify: (scope: JudgingScope, token: string) =>
      withLease(scope, token, (_tx, { round, job }) => ({
        expectedVersion: round.version,
        pendingBallot: job.pendingBallot,
      })),
    beginModelCall: (scope: JudgingScope, token: string) =>
      withLease(
        scope,
        token,
        async (tx, { run, job }) => {
          requireUndispatched(job, run);
          if (await judgingDispatchEnded(tx, scope)) {
            await failLockedJudgingJob(tx, scope, run.id);
            return null;
          }
          const reservation = await markLockedRoundBotModelCall(
            tx,
            scope.roundId,
          );
          await tx
            .update(agentRuns)
            .set({
              requests: run.requests + 1,
              configurationSnapshot: {
                ...run.configurationSnapshot,
                providerOutcome: 'unknown',
              },
            })
            .where(eq(agentRuns.id, run.id));
          return reservation;
        },
        true,
      ),
    recordUsage: (
      scope: JudgingScope,
      token: string,
      usage: { readonly inputTokens: number; readonly outputTokens: number },
    ) => recordJudgingUsage(input.run, scope, token, usage),
    saveResult: async (
      scope: JudgingScope,
      token: string,
      response: unknown,
      usage: { readonly inputTokens: number; readonly outputTokens: number },
    ) => {
      await recordJudgingUsage(input.run, scope, token, usage);
      const parsed = ballotSchema.safeParse(response);
      if (!parsed.success) throw createAppError('VALIDATION');
      return withLease(scope, token, async (tx, { run, job, now }) => {
        if (pendingBallotAction(job, run, parsed.data) === 'kept') return;
        await tx
          .update(roundJudgingJobs)
          .set({
            pendingBallot: parsed.data,
            pendingBallotAgentRunId: run.id,
            pendingBallotEpoch: scope.jobEpoch,
            pendingBallotReceivedAt: now,
          })
          .where(judgingJobWhere(scope));
      });
    },
    renew: (scope: JudgingScope, token: string) =>
      withLease(scope, token, async (tx, { now }) => {
        const expires = new Date(now.getTime() + input.leaseMs);
        await tx
          .update(roundJudgingJobs)
          .set({ leaseExpiresAt: expires })
          .where(judgingJobWhere(scope));
        return expires.toISOString();
      }),
  };
}
