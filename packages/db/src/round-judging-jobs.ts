import { eq, sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import {
  ballotSchema,
  caseMapSchema,
  judgingAttemptDiagnosticSchema,
  type Ballot,
  type CaseMap,
  type JudgingStage,
  type JudgingAttemptDiagnostic,
  type JudgingTerminalReason,
  type JudgingRecoveryReason,
  type JudgingWorkKind,
} from '@daisy/protocol';
import type { BoundedTransactionContext } from './transaction-context';
import type { BoundedTransaction } from './bounded-transaction';
import { agentRuns } from './schema/agent-runs';
import {
  roundJudgingAttempts,
  roundJudgingJobs,
} from './schema/round-judging-jobs';
import { discoverRoundJudgingJobs } from './round-judging-discovery';
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
  countCasualJudgeModelCall,
  settleCasualJudgeUsageLocked,
} from './casual-judge-usage';
import type { AllowanceAccountPolicy } from './usage-ledger';
import {
  nextJudgingStage,
  pendingBallotAction,
  requireNextStage,
  requireUndispatched,
} from './round-judging-decisions';
export type { JudgingScope } from './round-judging-context';
/** Whether a dispatch may go ahead, or why the job ended instead. */
export type ModelCallBegun =
  | { readonly kind: 'dispatched' }
  | { readonly kind: 'deferred'; readonly reason: JudgingRecoveryReason };
/** A lease renewed to a new expiry, or its budget had passed and the job ended. */
export type LeaseRenewed =
  | { readonly kind: 'renewed'; readonly leaseExpiresAt: string }
  | { readonly kind: 'ended'; readonly reason: JudgingTerminalReason };
/** A valid answer is held for submission, or its budget had passed and the job ended. */
export type AnswerSaved = { readonly kind: 'held' };
/** An earlier stage's validated output (ADR 0125): the first pass or the case map. */
export type StageRecord =
  | { readonly stage: 'first'; readonly ballot: unknown }
  | { readonly stage: 'map'; readonly caseMap: unknown };
export type AttemptDeferred =
  | { readonly kind: 'retry' }
  | {
      readonly kind: 'recovering' | 'blocked';
      readonly reason: JudgingRecoveryReason;
    };
/** The engine's rules for a job, injected; the facts and the clock come from here. */
export type JudgingJobRules = {
  readonly recover: (
    facts: {
      readonly totalPaidCalls: number;
      readonly windowPaidCalls: number;
      readonly generationDeadlineAt: string;
      readonly definiteRefusal: boolean;
    },
    nowMs: number,
  ) =>
    | {
        readonly status: 'blocked';
        readonly reason: JudgingRecoveryReason;
        readonly retryAt: null;
      }
    | {
        readonly status: 'recovering';
        readonly reason: JudgingRecoveryReason;
        readonly retryAt: string;
      }
    | {
        readonly status: 'queued';
        readonly reason: null;
        readonly retryAt: string;
      };
};
/** Calls that may have been served count; a call the vendor certainly refused does not. */
async function paidCalls(
  tx: BoundedTransactionContext,
  scope: JudgingScope,
  firstEpoch?: number,
) {
  const [row] = await tx.execute(sql`select (
    coalesce(sum(a.requests),0) - count(*) filter(where t.answered_at is null and t.category='provider_refused')
    )::int as paid
    from agent_runs a left join round_judging_attempts t on t.agent_run_id=a.id
    where a.round_participant_id=${scope.judgeParticipantId} and a.kind='judging' and a.requests>0
      and (${firstEpoch ?? null}::integer is null or t.job_epoch is null or t.job_epoch>=${firstEpoch ?? null}::integer)`);
  return Number(row!.paid);
}

const attemptOfRun = async (tx: BoundedTransactionContext, runId: string) =>
  (
    await tx
      .select()
      .from(roundJudgingAttempts)
      .where(eq(roundJudgingAttempts.agentRunId, runId))
      .for('update')
  )[0];
/** Release a bounded attempt while preserving its durable obligation and held reply. */
async function deferLockedJudgingJob(
  tx: BoundedTransactionContext,
  scope: JudgingScope,
  runId: string,
  recovery: ReturnType<JudgingJobRules['recover']>,
) {
  await endLockedRoundAgentRun(tx, runId, scope.judgeParticipantId);
  await tx
    .update(roundJudgingJobs)
    .set({
      status: recovery.status,
      recoveryReason: recovery.reason,
      retryAt: recovery.retryAt === null ? null : new Date(recovery.retryAt),
      leaseTokenDigest: null,
      leaseExpiresAt: null,
    })
    .where(judgingJobWhere(scope));
  await settleCasualJudgeUsageLocked(tx, scope.roundId);
}
/** Durable intents use the same injected bounded transaction; no provider I/O occurs under locks. */
export function createRoundJudgingJobs(input: {
  readonly run: BoundedTransaction;
  readonly nextId: () => string;
  readonly nextToken: () => string;
  readonly leaseMs: number;
  readonly model: string;
  /** The ballot contract each dispatch is made under. */
  readonly contractVersion: string;
  readonly rules: JudgingJobRules;
  readonly accountEligible: AllowanceAccountPolicy;
}) {
  requireLeaseMs(input.leaseMs);
  if (!input.model.trim()) throw createAppError('VALIDATION');
  const recoveryFor = async (
    tx: BoundedTransactionContext,
    scope: JudgingScope,
    job: {
      readonly generationDeadlineAt: Date;
      readonly generationFirstEpoch: number;
    },
    now: Date,
    definiteRefusal = false,
  ) =>
    input.rules.recover(
      {
        totalPaidCalls: await paidCalls(tx, scope),
        windowPaidCalls: await paidCalls(tx, scope, job.generationFirstEpoch),
        generationDeadlineAt: job.generationDeadlineAt.toISOString(),
        definiteRefusal,
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
    scan: (limit: number, workKind: JudgingWorkKind) =>
      input.run((tx) => discoverRoundJudgingJobs(tx, limit, workKind)),
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
        /** The stage this claim may buy, or null once a final ballot is held. */
        stage: nextJudgingStage(job),
        caseMap: job.caseMap,
      })),
    /** Ranked judging stays free; casual judging counts its admitted use before model I/O. */
    beginModelCall: (
      scope: JudgingScope,
      token: string,
      stage: JudgingStage,
    ): Promise<ModelCallBegun> =>
      withLease(scope, token, async (tx, { run, job, now }) => {
        requireUndispatched(job, await attemptOfRun(tx, run.id));
        requireNextStage(job, stage);
        const recovery = await recoveryFor(tx, scope, job, now);
        if (recovery.status !== 'queued') {
          await deferLockedJudgingJob(tx, scope, run.id, recovery);
          return { kind: 'deferred', reason: recovery.reason };
        }
        await countCasualJudgeModelCall(tx, {
          roundId: scope.roundId,
          before: new Date(
            Math.min(
              job.generationDeadlineAt.getTime(),
              job.leaseExpiresAt!.getTime(),
            ),
          ).toISOString(),
          accountEligible: input.accountEligible,
        });
        await tx
          .update(agentRuns)
          .set({ requests: run.requests + 1 })
          .where(eq(agentRuns.id, run.id));
        // Durable before the call is sent, so a crash still counts as bought.
        await tx.insert(roundJudgingAttempts).values({
          agentRunId: run.id,
          roundId: scope.roundId,
          judgeParticipantId: scope.judgeParticipantId,
          jobEpoch: scope.jobEpoch,
          model: run.model ?? input.model,
          contractVersion: input.contractVersion,
          stage,
          outcome: 'dispatched',
        });
        return { kind: 'dispatched' };
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
      return withLease(
        scope,
        token,
        async (tx, { run, job, now }): Promise<AnswerSaved> => {
          const attempt = await attemptOfRun(tx, run.id);
          if (attempt && attempt.stage !== 'final')
            throw createAppError('CONFLICT', 'Not a final-stage call');
          if (pendingBallotAction(job, attempt, parsed.data) === 'kept')
            return { kind: 'held' };
          await tx
            .update(roundJudgingAttempts)
            .set({ outcome: 'succeeded' })
            .where(eq(roundJudgingAttempts.agentRunId, run.id));
          await tx
            .update(roundJudgingJobs)
            .set({
              pendingBallot: parsed.data,
              pendingBallotAgentRunId: run.id,
              pendingBallotEpoch: scope.jobEpoch,
              pendingBallotReceivedAt: now,
            })
            .where(judgingJobWhere(scope));
          return { kind: 'held' };
        },
      );
    },
    /**
     * An earlier stage's validated output, stored once (ADR 0125). The claim
     * then ends and the job is due at once, so the next claim buys the next
     * stage; a takeover reads the stored output and never buys it again.
     */
    saveStage: async (
      scope: JudgingScope,
      token: string,
      record: StageRecord,
      usage: { readonly inputTokens: number; readonly outputTokens: number },
    ): Promise<void> => {
      await recordJudgingUsage(input.run, scope, token, usage);
      const value =
        record.stage === 'first'
          ? ballotSchema.safeParse(record.ballot)
          : caseMapSchema.safeParse(record.caseMap);
      if (!value.success) throw createAppError('VALIDATION');
      await withLease(scope, token, async (tx, { run, job, now }) => {
        const attempt = await attemptOfRun(tx, run.id);
        if (!attempt || attempt.stage !== record.stage)
          throw createAppError('CONFLICT', 'Model call not dispatched');
        requireNextStage(job, record.stage);
        await tx
          .update(roundJudgingAttempts)
          .set({ outcome: 'succeeded' })
          .where(eq(roundJudgingAttempts.agentRunId, run.id));
        await tx
          .update(roundJudgingJobs)
          .set(
            record.stage === 'first'
              ? {
                  firstBallot: value.data as Ballot,
                  firstBallotReceivedAt: now,
                }
              : { caseMap: value.data as CaseMap, caseMapReceivedAt: now },
          )
          .where(judgingJobWhere(scope));
        await deferLockedJudgingJob(tx, scope, run.id, {
          status: 'queued',
          reason: null,
          retryAt: now.toISOString(),
        });
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
        /** The refusal will not heal by retrying, such as no supporting endpoint. */
        readonly final: boolean;
      },
    ): Promise<AttemptDeferred> => {
      const diagnostic = judgingAttemptDiagnosticSchema.parse(
        input_.diagnostic,
      );
      return withLease(scope, token, async (tx, { run, job, now }) => {
        // The first validated reply won. An out-of-order failure cannot
        // rewrite its successful attempt or remove its submission authority.
        if (job.pendingBallot) return { kind: 'retry' as const };
        const attempt = await attemptOfRun(tx, run.id);
        if (!attempt)
          throw createAppError('CONFLICT', 'Model call not dispatched');
        // The first pass is a record with one try: it never holds back the ballot.
        if (attempt.stage === 'first')
          await tx
            .update(roundJudgingJobs)
            .set({ firstBallotFailed: true })
            .where(judgingJobWhere(scope));
        // A provider_refused attempt was certainly not served, so it buys nothing.
        await tx
          .update(roundJudgingAttempts)
          .set({
            outcome: 'failed',
            category: diagnostic.category,
            diagnostic,
          })
          .where(eq(roundJudgingAttempts.agentRunId, run.id));
        const recovery = await recoveryFor(tx, scope, job, now, input_.final);
        await deferLockedJudgingJob(tx, scope, run.id, recovery);
        return recovery.status === 'queued'
          ? { kind: 'retry' as const }
          : { kind: recovery.status, reason: recovery.reason };
      });
    },
    renew: (scope: JudgingScope, token: string): Promise<LeaseRenewed> =>
      withLease(scope, token, async (tx, { now }) => {
        // A provider call has its own finite timeout. Renewal preserves its
        // current authority so a validated response is not discarded at a window edge.
        const expires = new Date(now.getTime() + input.leaseMs);
        await tx
          .update(roundJudgingJobs)
          .set({ leaseExpiresAt: expires })
          .where(judgingJobWhere(scope));
        return { kind: 'renewed', leaseExpiresAt: expires.toISOString() };
      }),
  };
}
