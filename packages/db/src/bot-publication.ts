import { and, eq, sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import type { BoundedTransaction } from './bounded-transaction';
import { createBotGenerationOperations } from './bot-generation';
import { agentLeaseDigest } from './round-agent-lease';
import {
  endLockedRoundAgentRun,
  lockRoundAgentContext,
  roundAgentNow,
  startLockedRoundAgentRun,
} from './round-agent-runs';
import {
  verifyLockedBotWorker,
  requireBotSpeakingWindow,
  requireBotControlSegment,
  type BotPublicationScope,
  type PublicationWindow,
} from './bot-publication-context';
import { agentRuns } from './schema/agent-runs';
import { scanBotWorkers } from './bot-worker-discovery';
import { roundBotPublications } from './schema/round-bot-publications';
export type {
  BotPublicationScope,
  PublicationWindow,
} from './bot-publication-context';
type Target = Pick<
  BotPublicationScope,
  'roundId' | 'roundParticipantId' | 'segmentId'
>;
function nextPublicationEpoch(
  current: typeof roundBotPublications.$inferSelect | undefined,
) {
  const epoch = current ? current.publicationEpoch + 1 : 1;
  if (epoch > 2147483647)
    throw createAppError('CONFLICT', 'Publication epoch exhausted');
  return epoch;
}
/** Server-only capability; entropy and IDs are supplied by the authenticated composition edge. */
export function createBotPublicationOperations(input: {
  readonly run: BoundedTransaction;
  readonly nextId: () => string;
  readonly nextToken: () => string;
  readonly leaseMs: number;
  readonly models: { readonly speech: string; readonly cross_ex: string };
  readonly ttsModel?: string;
  readonly speechBudget?: number;
}) {
  if (
    !Number.isSafeInteger(input.leaseMs) ||
    input.leaseMs < 1 ||
    input.leaseMs > 60000
  )
    throw createAppError('VALIDATION');
  const claimWhere = (
    scope: Pick<BotPublicationScope, 'roundId' | 'roundParticipantId'>,
  ) =>
    and(
      eq(roundBotPublications.roundId, scope.roundId),
      eq(roundBotPublications.roundParticipantId, scope.roundParticipantId),
    );
  return {
    ...createBotGenerationOperations(input),
    scanWorkers: (limit: number) =>
      input.run((tx) => scanBotWorkers(tx, limit)),
    claimWorker: (target: Target) =>
      input.run(async (tx) => {
        const { round, seat } = await lockRoundAgentContext(
          tx,
          target.roundId,
          target.roundParticipantId,
        );
        if (round.status !== 'active' || seat.role === 'judge')
          throw createAppError('AUTHORIZATION');
        const [previous] = await tx
          .select()
          .from(roundBotPublications)
          .where(claimWhere(target));
        if (previous)
          await tx
            .select()
            .from(agentRuns)
            .where(eq(agentRuns.id, previous.agentRunId))
            .for('update');
        const [current] = await tx
          .select()
          .from(roundBotPublications)
          .where(claimWhere(target))
          .for('update');
        const now = await roundAgentNow(tx);
        await requireBotControlSegment(tx, target);
        if (current && current.leaseExpiresAt.getTime() > now.getTime())
          throw createAppError('CONFLICT', 'Publication already claimed');
        const epoch = nextPublicationEpoch(current);
        const segment = round.segments.find(
          (candidate) => candidate.id === target.segmentId,
        );
        if (!segment) throw createAppError('CONFLICT');
        const agentRunId = input.nextId(),
          token = input.nextToken();
        const digest = agentLeaseDigest(token);
        if (current)
          await endLockedRoundAgentRun(
            tx,
            current.agentRunId,
            target.roundParticipantId,
          );
        await startLockedRoundAgentRun(tx, {
          id: agentRunId,
          participantId: target.roundParticipantId,
          kind: segment.type,
          model: input.models[segment.type],
          configuration: {
            roundId: target.roundId,
            roundParticipantId: target.roundParticipantId,
            segmentId: target.segmentId,
            serviceId: `agent-run:${agentRunId}`,
            publicationEpoch: epoch,
          },
        });
        const value = {
          ...target,
          agentRunId,
          serviceId: `agent-run:${agentRunId}`,
          publicationEpoch: epoch,
          leaseTokenDigest: digest,
          leaseExpiresAt: new Date(now.getTime() + input.leaseMs),
        };
        await tx
          .insert(roundBotPublications)
          .values(value)
          .onConflictDoUpdate({
            target: [
              roundBotPublications.roundId,
              roundBotPublications.roundParticipantId,
            ],
            set: value,
          });
        const scope: BotPublicationScope = {
          ...target,
          agentRunId,
          serviceId: value.serviceId,
          publicationEpoch: epoch,
        };
        const leaseExpiresAt = value.leaseExpiresAt;
        return {
          scope,
          token,
          leaseExpiresAt: leaseExpiresAt.toISOString(),
          segmentType: segment.type,
          /** Activity peers only; grants no authority over another seat. */
          peerParticipantIds: round.participants
            .filter((row) => row.role !== 'judge' && row.id !== seat.id)
            .map((row) => row.id),
        };
      }),
    verifyBotPublication: (
      scope: BotPublicationScope,
      token: string,
      window?: PublicationWindow,
    ) =>
      input.run(async (tx) => {
        await verifyLockedBotWorker(tx, scope, token);
        await requireBotSpeakingWindow(tx, scope, window);
      }),
    verifyBotWorker: (scope: BotPublicationScope, token: string) =>
      input.run(async (tx) => {
        await verifyLockedBotWorker(tx, scope, token);
      }),
    renewWorker: (scope: BotPublicationScope, token: string) =>
      input.run(async (tx) => {
        await verifyLockedBotWorker(tx, scope, token);
        const rows = await tx
          .update(roundBotPublications)
          .set({
            leaseExpiresAt: sql`clock_timestamp()+${input.leaseMs}*interval '1 millisecond'`,
          })
          .where(
            and(
              claimWhere(scope),
              sql`${roundBotPublications.leaseExpiresAt}>clock_timestamp()`,
            ),
          )
          .returning({ expires: roundBotPublications.leaseExpiresAt });
        if (!rows[0]) throw createAppError('CONFLICT');
        return rows[0].expires.toISOString();
      }),
    revoke: (scope: BotPublicationScope, token: string) =>
      input.run(async (tx) => {
        await verifyLockedBotWorker(tx, scope, token);
        await tx
          .update(roundBotPublications)
          .set({ leaseExpiresAt: sql`clock_timestamp()` })
          .where(claimWhere(scope));
        await endLockedRoundAgentRun(
          tx,
          scope.agentRunId,
          scope.roundParticipantId,
        );
      }),
  };
}

export { verifyBotWorkerPrincipalLocked } from './bot-worker-authority';
