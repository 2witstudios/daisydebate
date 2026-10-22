import { and, asc, eq, or, sql } from 'drizzle-orm';
import { isDeepStrictEqual } from 'node:util';
import { createAppError } from '@daisy/errors';
import { ballotSchema } from '@daisy/protocol';
import type { BoundedTransactionContext } from './transaction-context';
import type { BoundedTransaction } from './bounded-transaction';
import { agentRuns } from './schema/agent-runs';
import { roundJudgingJobs } from './schema/round-judging-jobs';
import { rounds } from './schema/rounds';
import { lockRoundAgentContext } from './round-agent-runs';
import {
  assertLockedJudgingLease,
  judgingJobWhere,
  type JudgingScope,
} from './round-judging-context';
import { claimLockedJudgingJob } from './round-judging-claim';
import { submitLockedJudgingResult } from './round-judging-result';
import type { LockedRoundBallotInput } from './round-ballot-operations';
export type { JudgingScope } from './round-judging-context';
/** Durable intents use the same injected bounded transaction; no provider I/O occurs under locks. */
export function createRoundJudgingJobs(input: {
  readonly run: BoundedTransaction;
  readonly nextId: () => string;
  readonly nextToken: () => string;
  readonly leaseMs: number;
  readonly model: string;
}) {
  if (
    !Number.isSafeInteger(input.leaseMs) ||
    input.leaseMs < 1 ||
    input.leaseMs > 60000 ||
    !input.model.trim()
  )
    throw createAppError('VALIDATION');
  const withLease = <T>(
    scope: JudgingScope,
    token: string,
    work: (
      tx: BoundedTransactionContext,
      lease: Awaited<ReturnType<typeof assertLockedJudgingLease>>,
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
      return work(tx, lease);
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
    verify: async (scope: JudgingScope, token: string) => {
      await withLease(scope, token, () => undefined);
    },
    beginModelCall: (scope: JudgingScope, token: string) =>
      withLease(scope, token, async (tx, { run, job }) => {
        if (
          job.pendingBallot ||
          run.configurationSnapshot.providerOutcome !== 'not_started'
        )
          throw createAppError('CONFLICT', 'Model call already dispatched');
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
      }),
    saveResult: (scope: JudgingScope, token: string, response: unknown) => {
      const parsed = ballotSchema.safeParse(response);
      if (!parsed.success) throw createAppError('VALIDATION');
      return withLease(scope, token, async (tx, { run, job, now }) => {
        if (job.pendingBallot) {
          if (!isDeepStrictEqual(job.pendingBallot, parsed.data))
            throw createAppError(
              'CONFLICT',
              'Judging response already recorded',
            );
          return;
        }
        if (run.configurationSnapshot.providerOutcome !== 'unknown')
          throw createAppError('CONFLICT', 'Model call not dispatched');
        await tx
          .update(roundJudgingJobs)
          .set({
            pendingBallot: parsed.data,
            pendingBallotAgentRunId: run.id,
            pendingBallotEpoch: scope.jobEpoch,
            pendingBallotReceivedAt: now,
          })
          .where(judgingJobWhere(scope));
        await tx
          .update(agentRuns)
          .set({
            configurationSnapshot: {
              ...run.configurationSnapshot,
              providerOutcome: 'received',
            },
          })
          .where(eq(agentRuns.id, run.id));
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
