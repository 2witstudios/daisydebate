import type { DecisionReleasePolicy } from '@daisy/protocol/round-decision-release';
import { eq, sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import { ballotRecordSchema } from '@daisy/protocol/ballot-schema';
import { caseMapSchema } from '@daisy/protocol/case-map';
import { isJudgeSeat } from '@daisy/protocol/seats';
import {
  judgingAttemptDiagnosticSchema,
  type JudgingStage,
  type JudgingAttemptDiagnostic,
  type JudgingTerminalReason,
  type JudgingRecoveryReason,
} from '@daisy/protocol/round-judging-attempt';
import { type JudgingWorkKind } from '@daisy/protocol/judging-policy';
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
  pendingBallotAction,
  requireUndispatched,
} from './round-judging-decisions';
import {
  applyJudgingProgression,
  judgingStageFacts,
  type JudgingProgression,
} from './round-judging-progression';
export type { JudgingProgression } from './round-judging-progression';
import { requireRoundBallot } from './round-ballot-decisions';
import type { Tx } from './tx';
import { takeLock, transactionLocks } from './locks';
import { query } from './raw-rows';
import { z } from 'zod';
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
/**
 * A stage record validated by its own contract, as the job's columns it
 * fills: the first pass is a ballot in any definition's structure (the
 * Round's own schema judges the final one), the case map its own.
 */
function storedStage(record: StageRecord) {
  if (record.stage === 'first') {
    const ballot = ballotRecordSchema.safeParse(record.ballot);
    if (!ballot.success) throw createAppError('VALIDATION');
    return (now: Date) => ({
      firstBallot: ballot.data,
      firstBallotReceivedAt: now,
    });
  }
  const caseMap = caseMapSchema.safeParse(record.caseMap);
  if (!caseMap.success) throw createAppError('VALIDATION');
  return (now: Date) => ({ caseMap: caseMap.data, caseMapReceivedAt: now });
}
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
async function paidCalls(tx: Tx, scope: JudgingScope, firstEpoch?: number) {
  const [row] = await query(
    tx,
    z.object({ paid: z.int() }),
    sql`select (
    coalesce(sum(a.requests),0) - count(*) filter(where t.answered_at is null and t.category='provider_refused')
    )::int as paid
    from agent_runs a left join round_judging_attempts t on t.agent_run_id=a.id
    where a.round_participant_id=${scope.judgeParticipantId} and a.kind='judging' and a.requests>0
      and (${firstEpoch ?? null}::integer is null or t.job_epoch is null or t.job_epoch>=${firstEpoch ?? null}::integer)`,
  );
  if (!row) throw createAppError('INVARIANT');
  return Number(row.paid);
}

const attemptOfRun = async (tx: Tx, runId: string) =>
  (
    await tx
      .select()
      .from(roundJudgingAttempts)
      .where(eq(roundJudgingAttempts.agentRunId, runId))
      .for('update')
  )[0];
/** Release a bounded attempt while preserving its durable obligation and held reply. */
async function deferLockedJudgingJob(
  tx: Tx,
  scope: JudgingScope,
  runId: string,
  recovery: ReturnType<JudgingJobRules['recover']>,
  writing: () => void,
) {
  await endLockedRoundAgentRun(tx, runId, scope.judgeParticipantId);
  writing();
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
  writing();
  await settleCasualJudgeUsageLocked(tx, scope.roundId);
  writing();
}
/** Durable intents use the same injected bounded transaction; no provider I/O occurs under locks. */
export function createRoundJudgingJobs(input: {
  readonly run: BoundedTransaction;
  readonly decisionRelease?: DecisionReleasePolicy | undefined;
  readonly nextId: () => string;
  readonly nextToken: () => string;
  readonly leaseMs: number;
  readonly model: string;
  /** The ballot contract each dispatch is made under. */
  readonly contractVersion: string;
  readonly rules: JudgingJobRules;
  readonly progression: JudgingProgression;
  readonly accountEligible: AllowanceAccountPolicy;
}) {
  requireLeaseMs(input.leaseMs);
  if (!input.model.trim()) throw createAppError('VALIDATION');
  const recoveryFor = async (
    tx: Tx,
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
      tx: Tx,
      lease: Awaited<ReturnType<typeof assertLockedJudgingLease>> & {
        round: Awaited<ReturnType<typeof lockRoundAgentContext>>['round'];
      },
    ) => T | Promise<T>,
  ) =>
    input.run(async (tx) => {
      await takeLock(tx, transactionLocks.roundCommand(scope.commandId));
      const context = await lockRoundAgentContext(
        tx,
        scope.roundId,
        scope.judgeParticipantId,
      );
      if (!isJudgeSeat(context.seat.seat))
        throw createAppError('AUTHORIZATION');
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
      input.run((tx) =>
        submitLockedJudgingResult(tx, scope, token, {
          ...prepared,
          decisionRelease: input.decisionRelease,
        }),
      ),
    verify: (scope: JudgingScope, token: string) =>
      withLease(scope, token, (_tx, { round, job }) =>
        applyJudgingProgression(
          input.progression,
          { kind: 'inspect', facts: judgingStageFacts(job) },
          async ({ progress }, writing) => {
            await assertLockedJudgingLease(_tx, scope, token);
            writing();
            return { expectedVersion: round.version, progress };
          },
        ),
      ),
    /** Ranked judging stays free; casual judging counts its admitted use before model I/O. */
    beginModelCall: (
      scope: JudgingScope,
      token: string,
      stage: JudgingStage,
    ): Promise<ModelCallBegun> =>
      withLease(scope, token, async (tx, { run, job }) => {
        requireUndispatched(job, await attemptOfRun(tx, run.id));
        return applyJudgingProgression(
          input.progression,
          { kind: 'dispatch', facts: judgingStageFacts(job), stage },
          async (_decision, writing): Promise<ModelCallBegun> => {
            const current = await assertLockedJudgingLease(tx, scope, token);
            writing();
            const recovery = await recoveryFor(tx, scope, job, current.now);
            writing();
            if (recovery.status !== 'queued') {
              await deferLockedJudgingJob(tx, scope, run.id, recovery, writing);
              writing();
              return { kind: 'deferred', reason: recovery.reason };
            }
            if (!job.leaseExpiresAt) throw createAppError('INVARIANT');
            await countCasualJudgeModelCall(tx, {
              roundId: scope.roundId,
              before: new Date(
                Math.min(
                  job.generationDeadlineAt.getTime(),
                  job.leaseExpiresAt.getTime(),
                ),
              ).toISOString(),
              accountEligible: input.accountEligible,
            });
            writing();
            await assertLockedJudgingLease(tx, scope, token);
            writing();
            await tx
              .update(agentRuns)
              .set({ requests: run.requests + 1 })
              .where(eq(agentRuns.id, run.id));
            writing();
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
            writing();
            return { kind: 'dispatched' };
          },
        );
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
      return withLease(
        scope,
        token,
        async (tx, { run, job, now, round }): Promise<AnswerSaved> => {
          // The final ballot fits the Round's own frozen definition (TAB-6.11).
          const parsed = { data: requireRoundBallot(round, response) };
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
      const stored = storedStage(record);
      await withLease(scope, token, async (tx, { run, job, now }) => {
        const attempt = await attemptOfRun(tx, run.id);
        if (!attempt || attempt.stage !== record.stage)
          throw createAppError('CONFLICT', 'Model call not dispatched');
        return applyJudgingProgression(
          input.progression,
          {
            kind: 'record',
            facts: judgingStageFacts(job),
            stage: record.stage,
          },
          async (_decision, writing) => {
            await assertLockedJudgingLease(tx, scope, token);
            writing();
            await tx
              .update(roundJudgingAttempts)
              .set({ outcome: 'succeeded' })
              .where(eq(roundJudgingAttempts.agentRunId, run.id));
            writing();
            await tx
              .update(roundJudgingJobs)
              .set(stored(now))
              .where(judgingJobWhere(scope));
            writing();
            await deferLockedJudgingJob(
              tx,
              scope,
              run.id,
              {
                status: 'queued',
                reason: null,
                retryAt: now.toISOString(),
              },
              writing,
            );
            writing();
          },
        );
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
        return applyJudgingProgression(
          input.progression,
          {
            kind: 'failure',
            facts: judgingStageFacts(job),
            stage: attempt.stage,
          },
          async ({ spendFirstPass }, writing): Promise<AttemptDeferred> => {
            await assertLockedJudgingLease(tx, scope, token);
            writing();
            if (spendFirstPass)
              await tx
                .update(roundJudgingJobs)
                .set({ firstBallotFailed: true })
                .where(judgingJobWhere(scope));
            writing();
            // A provider_refused attempt was certainly not served, so it buys nothing.
            await tx
              .update(roundJudgingAttempts)
              .set({
                outcome: 'failed',
                category: diagnostic.category,
                diagnostic,
              })
              .where(eq(roundJudgingAttempts.agentRunId, run.id));
            writing();
            const recovery = await recoveryFor(
              tx,
              scope,
              job,
              now,
              input_.final,
            );
            writing();
            await deferLockedJudgingJob(tx, scope, run.id, recovery, writing);
            writing();
            return recovery.status === 'queued'
              ? { kind: 'retry' as const }
              : { kind: recovery.status, reason: recovery.reason };
          },
        );
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
