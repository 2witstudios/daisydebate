import { eq, sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import type { BoundedTransaction } from './bounded-transaction';
import type { JudgingScope } from './round-judging-context';
import { lockAgentAccounting, validAgentCounter } from './agent-accounting';
import { agentRuns } from './schema/agent-runs';
import { roundJudgingAttempts } from './schema/round-judging-jobs';

/** Known response counters survive parse/lease/lifecycle rejection without granting result authority. */
export function recordJudgingUsage(
  run: BoundedTransaction,
  scope: JudgingScope,
  token: string,
  usage: { readonly inputTokens: number; readonly outputTokens: number },
) {
  if (
    !usage ||
    ![usage.inputTokens, usage.outputTokens].every(validAgentCounter)
  )
    throw createAppError('INFRASTRUCTURE', 'Invalid model usage');
  return run(async (tx) => {
    const execution = await lockAgentAccounting(tx, {
      id: scope.agentRunId,
      participantId: scope.judgeParticipantId,
      token,
      bindings: {
        roundId: scope.roundId,
        judgeParticipantId: scope.judgeParticipantId,
        agentRunId: scope.agentRunId,
        serviceId: scope.serviceId,
        commandId: scope.commandId,
        freezeRevision: scope.freezeRevision,
        jobEpoch: scope.jobEpoch,
      },
    });
    if (execution.kind !== 'judging') throw createAppError('AUTHORIZATION');
    const [attempt] = await tx
      .select()
      .from(roundJudgingAttempts)
      .where(eq(roundJudgingAttempts.agentRunId, execution.id))
      .for('update');
    if (attempt?.answeredAt) {
      if (
        execution.inputTokens !== usage.inputTokens ||
        execution.outputTokens !== usage.outputTokens
      )
        throw createAppError('CONFLICT', 'Judging usage already recorded');
      return;
    }
    if (!attempt || attempt.category === 'provider_refused')
      throw createAppError('CONFLICT', 'Model call not dispatched');
    await tx.update(agentRuns).set(usage).where(eq(agentRuns.id, execution.id));
    await tx
      .update(roundJudgingAttempts)
      .set({ answeredAt: sql`clock_timestamp()` })
      .where(eq(roundJudgingAttempts.agentRunId, execution.id));
  });
}
