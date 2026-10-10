import { and, eq } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import {
  messagingDmPairs,
  messagingSocialCommands,
} from '../schema/messaging-social';
import { withMessagingChannel } from './channel-frame';
import { readMessagingChannelFact } from './social';
import { advanceSocialChannelAuthority } from './social-channel-change';
import type {
  MessagingDmFence,
  MessagingDmStore,
  MessagingDmFrame,
} from './dm-contracts';
type DecisionCommand = Parameters<MessagingDmFrame['readDecisionState']>[0];
const decisionMode = (decision: DecisionCommand['decision']) =>
  decision === 'cancel' ? 'cancel' : 'decide';
const resultStates = {
  accept: 'accepted',
  decline: 'declined',
  cancel: 'cancelled',
} as const;

/** Only the dedicated request grant may inspect introduction/receipts or change pending state. */
export function createMessagingDmStore({
  database,
  authorize,
}: {
  readonly database: BunSQLDatabase;
  readonly authorize: MessagingDmFence;
}): MessagingDmStore {
  return {
    withChannel: (scope, work) =>
      withMessagingChannel(
        database,
        scope,
        async ({ tx, channel, accounts }) => {
          let observed: DecisionCommand | null = null;
          const currentFact = async () => {
            const fact = await readMessagingChannelFact(
              tx,
              scope.channelId,
              scope.actorId,
            );
            if (!fact || fact.authority.kind !== 'dm')
              throw createAppError('NOT_FOUND');
            return fact;
          };
          const currentRequest = async () => {
            const [row] = await tx
              .select()
              .from(messagingDmPairs)
              .where(eq(messagingDmPairs.channelId, scope.channelId));
            if (!row) throw createAppError('NOT_FOUND');
            return row;
          };
          const fresh = async (mode: Parameters<MessagingDmFence>[0]) => {
            const fact = await currentFact();
            await authorize(mode)(tx, scope, { fact, accounts });
            return fact;
          };
          return work({
            async readRequest() {
              await fresh('read');
              const row = await currentRequest();
              return {
                channelId: row.channelId,
                senderActorId: row.requestSenderActorId,
                introduction: row.introduction,
                requestedAt: row.requestedAt.toISOString(),
              };
            },
            async readDecisionState(command) {
              validateDecision(command);
              const fact = await currentFact();
              if (fact.authority.kind !== 'dm')
                throw createAppError('NOT_FOUND');
              await authorize(
                fact.authority.state === 'pending'
                  ? decisionMode(command.decision)
                  : 'result',
              )(tx, scope, { fact, accounts });
              const row = await currentRequest();
              const [receipt] = await tx
                .select({
                  kind: messagingSocialCommands.kind,
                  digest: messagingSocialCommands.digest,
                  channelId: messagingSocialCommands.resultChannelId,
                })
                .from(messagingSocialCommands)
                .where(
                  and(
                    eq(messagingSocialCommands.actorId, scope.actorId),
                    eq(messagingSocialCommands.requestId, command.requestId),
                  ),
                );
              observed = {
                requestId: command.requestId,
                decision: command.decision,
              };
              return {
                channelId: scope.channelId,
                state: row.requestState,
                requestedAt: row.requestedAt.toISOString(),
                receipt: receipt ?? null,
              };
            },
            async commitDecision(command) {
              if (
                !observed ||
                observed.requestId !== command.requestId ||
                observed.decision !== command.decision
              )
                throw createAppError('CONFLICT');
              const fact = await fresh(decisionMode(command.decision));
              if (fact.authority.kind !== 'dm')
                throw createAppError('NOT_FOUND');
              const state = resultStates[command.decision];
              const changed = await tx
                .update(messagingDmPairs)
                .set({ requestState: state, decidedAt: new Date(command.now) })
                .where(
                  and(
                    eq(messagingDmPairs.channelId, scope.channelId),
                    eq(messagingDmPairs.requestState, 'pending'),
                  ),
                )
                .returning({ channelId: messagingDmPairs.channelId });
              if (!changed[0]) throw createAppError('CONFLICT');
              const counterpartActorId =
                fact.authority.lowActorId === scope.actorId
                  ? fact.authority.highActorId
                  : fact.authority.lowActorId;
              await tx.insert(messagingSocialCommands).values({
                actorId: scope.actorId,
                counterpartActorId,
                requestId: command.requestId,
                kind: 'dm.decide',
                digest: command.digest,
                resultChannelId: scope.channelId,
                createdAt: new Date(command.now),
              });
              await advanceSocialChannelAuthority(tx, channel);
              observed = null;
              return { channelId: scope.channelId, state };
            },
          });
        },
      ),
  };
}
function validateDecision(command: DecisionCommand) {
  if (
    !idSchema.safeParse(command.requestId).success ||
    !['accept', 'decline', 'cancel'].includes(command.decision)
  )
    throw createAppError('VALIDATION');
}
