import { and, asc, eq, or, sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import {
  ballotSchema,
  judgingAttemptDiagnosticSchema,
  judgingPolicy,
  type JudgingAttemptDiagnostic,
  type JudgingTerminalReason,
} from '@daisy/protocol';
import type { BoundedTransactionContext } from './transaction-context';
import type { BoundedTransaction } from './bounded-transaction';
import { agentRuns } from './schema/agent-runs';
import {
  roundJudgingAttempts,
  roundJudgingJobs,
} from './schema/round-judging-jobs';
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
import { requireLeaseMs } from './lease-policy';
import {
  pendingBallotAction,
  requireUndispatched,
} from './round-judging-decisions';
export type { JudgingScope } from './round-judging-context';
/** The engine's rules for a job, injected; the facts and the clock come from here. */
export type JudgingJobRules = {
  readonly budgetSpent: (
    job: {
      readonly generationDeadlineAt: string;
      readonly holdsBallot: boolean;
    },
    nowMs: number,
  ) => boolean;
  readonly dispatchEnd: (
    input: {
      readonly paidCalls: number;
      readonly generationDeadlineAt: string;
    },
    nowMs: number,
  ) => JudgingTerminalReason | null;
};
/** Calls that may have been served count; a call the vendor certainly refused does not. */
async function paidCalls(tx: BoundedTransactionContext, scope: JudgingScope) {
  const [row] =
    (await tx.execute(sql`select count(*)::int as paid from agent_runs
      where round_participant_id=${scope.judgeParticipantId} and kind='judging'
        and configuration_snapshot->>'commandId'=${scope.commandId}
        and configuration_snapshot->>'providerOutcome' in ('unknown','received')`)) as unknown as {
      paid: number;
    }[];
  return row!.paid;
}
/** The terminal state: no lease, never rediscovered; panel completion reads it. */
async function failLockedJudgingJob(
  tx: BoundedTransactionContext,
  scope: JudgingScope,
  runId: string,
  terminalReason: JudgingTerminalReason,
) {
  await endLockedRoundAgentRun(tx, runId, scope.judgeParticipantId);
  await tx
    .update(roundJudgingJobs)
    .set({
      status: 'failed',
      terminalReason,
      retryAt: null,
      leaseTokenDigest: null,
      leaseExpiresAt: null,
    })
    .where(judgingJobWhere(scope));
}
/** Durable intents use the same injected bounded transaction; no provider I/O occurs under locks. */
export function createRoundJudgingJobs(input: {
  readonly run: BoundedTransaction;
  readonly nextId: () => string;
  readonly nextToken: () => string;
  readonly leaseMs: number;
  readonly model: string;
  readonly rules: JudgingJobRules;
}) {
  requireLeaseMs(input.leaseMs);
  if (!input.model.trim()) throw createAppError('VALIDATION');
  const dispatchEnded = async (
    tx: BoundedTransactionContext,
    scope: JudgingScope,
    job: { readonly generationDeadlineAt: Date },
    now: Date,
  ) =>
    input.rules.dispatchEnd(
      {
        paidCalls: await paidCalls(tx, scope),
        generationDeadlineAt: job.generationDeadlineAt.toISOString(),
      },
      now.getTime(),
    );
  const budgetSpent = (
    job: {
      readonly generationDeadlineAt: Date;
      readonly pendingBallot: unknown;
    },
    now: Date,
  ) =>
    input.rules.budgetSpent(
      {
        generationDeadlineAt: job.generationDeadlineAt.toISOString(),
        holdsBallot: job.pendingBallot !== null,
      },
      now.getTime(),
    );
  const withLease = <T>(
    scope: JudgingScope,
    token: string,
    work: (
      tx: BoundedTransactionContext,
      lease: Awaited<ReturnType<typeof assertLockedJudgingLease>> & {
        round: Awaited<ReturnType<typeof lockRoundAgentContext>>['round'];
      },
    ) => T | Promise<T>,
  ) =>
    input.run(async (tx) => {
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
            holdsBallot: sql<boolean>`${roundJudgingJobs.pendingBallot} is not null`,
          })
          .from(roundJudgingJobs)
          .innerJoin(rounds, eq(rounds.id, roundJudgingJobs.roundId))
          .where(
            and(
              eq(rounds.status, 'active'),
              or(
                and(
                  eq(roundJudgingJobs.status, 'queued'),
                  sql`coalesce(${roundJudgingJobs.retryAt}<=clock_timestamp(),true)`,
                ),
                and(
                  eq(roundJudgingJobs.status, 'leased'),
                  sql`${roundJudgingJobs.leaseExpiresAt}<=clock_timestamp()`,
                ),
              ),
            ),
          )
          // Work against a budget first: a held ballot's retry buys nothing.
          .orderBy(
            sql`${roundJudgingJobs.pendingBallot} is not null`,
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
    /** The AI judge is free (DEC-186): no reservation, no bot-admission lock. */
    beginModelCall: (scope: JudgingScope, token: string) =>
      withLease(scope, token, async (tx, { run, job, now }) => {
        requireUndispatched(job, run);
        const ended = await dispatchEnded(tx, scope, job, now);
        if (ended) {
          await failLockedJudgingJob(tx, scope, run.id, ended);
          return false;
        }
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
        return true;
      }),
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
        if (pendingBallotAction(job, run, parsed.data) === 'kept') return true;
        // A late answer keeps its accounted usage above and gains no authority.
        if (budgetSpent(job, now)) {
          await failLockedJudgingJob(tx, scope, run.id, 'generation_deadline');
          return false;
        }
        await tx
          .update(roundJudgingJobs)
          .set({
            pendingBallot: parsed.data,
            pendingBallotAgentRunId: run.id,
            pendingBallotEpoch: scope.jobEpoch,
            pendingBallotReceivedAt: now,
          })
          .where(judgingJobWhere(scope));
        return true;
      });
    },
    /**
     * Durable and immediate: the attempt's safe reason, then either a later
     * retry or the job's terminal state, on the failed call itself and never on
     * some future claim. Returns which, so the worker can release its slot.
     */
    recordAttemptFailure: (
      scope: JudgingScope,
      token: string,
      input_: {
        readonly diagnostic: JudgingAttemptDiagnostic;
        readonly contractVersion: string;
        /** The vendor certainly did not serve this call, so it buys nothing. */
        readonly definite: boolean;
        /** The refusal will not heal by retrying, such as no supporting endpoint. */
        readonly final: boolean;
      },
    ): Promise<'retry' | JudgingTerminalReason> => {
      const diagnostic = judgingAttemptDiagnosticSchema.parse(
        input_.diagnostic,
      );
      return withLease(scope, token, async (tx, { run, job, now }) => {
        await tx.insert(roundJudgingAttempts).values({
          agentRunId: run.id,
          roundId: scope.roundId,
          judgeParticipantId: scope.judgeParticipantId,
          jobEpoch: scope.jobEpoch,
          model: run.model ?? input.model,
          contractVersion: input_.contractVersion,
          category: diagnostic.category,
          diagnostic,
        });
        if (
          input_.definite &&
          run.configurationSnapshot.providerOutcome === 'unknown'
        )
          await tx
            .update(agentRuns)
            .set({
              configurationSnapshot: {
                ...run.configurationSnapshot,
                providerOutcome: 'refused',
              },
            })
            .where(eq(agentRuns.id, run.id));
        const ended = input_.final
          ? 'provider_refused'
          : await dispatchEnded(tx, scope, job, now);
        if (ended && !job.pendingBallot) {
          await failLockedJudgingJob(tx, scope, run.id, ended);
          return ended;
        }
        await endLockedRoundAgentRun(tx, run.id, scope.judgeParticipantId);
        await tx
          .update(roundJudgingJobs)
          .set({
            status: 'queued',
            leaseTokenDigest: null,
            leaseExpiresAt: null,
            retryAt: new Date(now.getTime() + judgingPolicy.retryMs),
          })
          .where(judgingJobWhere(scope));
        return 'retry';
      });
    },
    renew: (scope: JudgingScope, token: string) =>
      withLease(scope, token, async (tx, { run, job, now }) => {
        // Cancels the running call: the worker releases on this refusal.
        if (budgetSpent(job, now)) {
          await failLockedJudgingJob(tx, scope, run.id, 'generation_deadline');
          return null;
        }
        const expires = new Date(now.getTime() + input.leaseMs);
        await tx
          .update(roundJudgingJobs)
          .set({ leaseExpiresAt: expires })
          .where(judgingJobWhere(scope));
        return expires.toISOString();
      }),
  };
}
