import { and, eq } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import {
  messagingDmPairs,
  messagingSocialCommands,
} from '../schema/messaging-social';
import {
  readMessagingChannel,
  withMessagingAuthorityChange,
} from './channel-frame';
import { readMessagingChannelFact } from './social';
import { advanceSocialChannelAuthority } from './social-channel-change';
import {
  clearSocialDeclines,
  recordSocialDecline,
} from '../contacts/request-budget';
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
    readRequest: (scope) =>
      readMessagingChannel(database, scope, async ({ tx, accounts }) => {
        const fact = await readMessagingChannelFact(
          tx,
          scope.channelId,
          scope.actorId,
        );
        if (!fact || fact.authority.kind !== 'dm')
          throw createAppError('NOT_FOUND');
        await authorize('read')(tx, scope, { fact, accounts });
        // The preview projects sender, introduction and time, never more.
        const row = await readRequestRow(tx, scope.channelId);
        return {
          channelId: row.channelId,
          senderActorId: row.requestSenderActorId,
          introduction: row.introduction,
          requestedAt: row.requestedAt.toISOString(),
        };
      }),
    withChannel: (scope, work) =>
      withMessagingAuthorityChange(
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
          const currentRequest = () => readRequestRow(tx, scope.channelId);
          const fresh = async (mode: Parameters<MessagingDmFence>[0]) => {
            const fact = await currentFact();
            await authorize(mode)(tx, scope, { fact, accounts });
            return fact;
          };
          return work({
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
              if (command.decision === 'decline')
                await recordSocialDecline(tx, {
                  declinerActorId: scope.actorId,
                  requesterActorId: counterpartActorId,
                  now: command.now,
                  limits: command.limits,
                });
              if (command.decision === 'accept')
                await clearSocialDeclines(
                  tx,
                  scope.actorId,
                  counterpartActorId,
                );
              await advanceSocialChannelAuthority(tx, channel);
              observed = null;
              return { channelId: scope.channelId, state };
            },
          });
        },
      ),
  };
}
/** The one read of a DM pair's request row, for the preview and decisions. */
async function readRequestRow(
  tx: Pick<BunSQLDatabase, 'select'>,
  channelId: string,
) {
  const [row] = await tx
    .select()
    .from(messagingDmPairs)
    .where(eq(messagingDmPairs.channelId, channelId));
  if (!row) throw createAppError('NOT_FOUND');
  return row;
}
function validateDecision(command: DecisionCommand) {
  if (
    !idSchema.safeParse(command.requestId).success ||
    !['accept', 'decline', 'cancel'].includes(command.decision)
  )
    throw createAppError('VALIDATION');
}
