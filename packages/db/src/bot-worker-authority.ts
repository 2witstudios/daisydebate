import { and, eq } from 'drizzle-orm';
import { idSchema } from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { requireClaimScope, requireRunScope } from './bot-publication-context';
import { roundAgentNow } from './round-agent-runs';
import { agentRuns } from './schema/agent-runs';
import { roundBotPublications } from './schema/round-bot-publications';

type Reader = Pick<BunSQLDatabase, 'select' | 'execute'>;
type WorkerPrincipal = {
  readonly kind: 'agent';
  readonly serviceId: string;
  readonly agentRunId: string;
  readonly participantId: string;
  readonly publicationEpoch: number;
};
/** Trusted server principal only; caller already holds canonical account/Round fences. No bearer comes from a public body. */
export async function verifyBotWorkerPrincipalLocked(
  tx: Reader,
  principal: WorkerPrincipal,
  roundId: string,
) {
  if (
    ![roundId, principal.agentRunId, principal.participantId].every(
      (id) => idSchema.safeParse(id).success,
    ) ||
    !Number.isSafeInteger(principal.publicationEpoch) ||
    principal.publicationEpoch < 1
  )
    throw createAppError('VALIDATION');
  if (principal.serviceId !== `agent-run:${principal.agentRunId}`)
    throw createAppError('AUTHORIZATION');
  const [run] = await tx
    .select()
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.id, principal.agentRunId),
        eq(agentRuns.roundParticipantId, principal.participantId),
      ),
    )
    .for('share');
  const [claim] = await tx
    .select()
    .from(roundBotPublications)
    .where(
      and(
        eq(roundBotPublications.roundId, roundId),
        eq(roundBotPublications.roundParticipantId, principal.participantId),
      ),
    )
    .for('share');
  if (!claim) throw createAppError('CONFLICT', 'Worker claim missing');
  const scope = {
    roundId,
    roundParticipantId: principal.participantId,
    segmentId: claim.segmentId,
    agentRunId: principal.agentRunId,
    serviceId: principal.serviceId,
    publicationEpoch: principal.publicationEpoch,
  };
  requireClaimScope(claim, scope);
  requireRunScope(run, scope);
  const now = await roundAgentNow(tx);
  if (claim.leaseExpiresAt.getTime() <= now.getTime())
    throw createAppError('CONFLICT', 'Worker lease expired');
}
