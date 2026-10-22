import { and, eq } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import type { BoundedTransactionContext } from './transaction-context';
import { requireAgentLeaseToken } from './round-agent-lease';
import { agentRuns } from './schema/agent-runs';

export const validAgentCounter = (value: number) =>
  Number.isSafeInteger(value) && value >= 0 && value <= 2147483647;
/** Authenticates original execution accounting only; does not confer a live competitive lease. */
export async function lockAgentAccounting(
  tx: BoundedTransactionContext,
  input: {
    readonly id: string;
    readonly participantId: string;
    readonly token: string;
    readonly bindings: Readonly<Record<string, string | number>>;
  },
) {
  const [run] = await tx
    .select()
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.id, input.id),
        eq(agentRuns.roundParticipantId, input.participantId),
      ),
    )
    .for('update');
  const configuration = run?.configurationSnapshot;
  if (
    !run ||
    !configuration ||
    typeof configuration.executionTokenDigest !== 'string' ||
    Object.entries(input.bindings).some(
      ([key, value]) => configuration[key] !== value,
    )
  )
    throw createAppError('AUTHORIZATION');
  requireAgentLeaseToken(input.token, configuration.executionTokenDigest);
  if (run.requests !== 1)
    throw createAppError('CONFLICT', 'Execution not dispatched');
  return run;
}
