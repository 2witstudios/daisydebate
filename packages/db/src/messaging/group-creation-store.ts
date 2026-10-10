import { and, eq, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import { lockAuthorizationActors } from '../authorization';
import { messagingSocialCommands } from '../schema/messaging-social';
import { readMessagingChannelFact, type MessagingChannelFact } from './social';
import { lockGroupContacts } from './group-contact-locks';
import { writeMessagingGroupCreation } from './group-creation-write';
import type {
  MessagingGroupCreationScope,
  MessagingGroupCreationFence,
  MessagingGroupCreationStore,
} from './group-creation-contracts';
function proposalActors(scope: MessagingGroupCreationScope) {
  const actors = [...scope.proposedActorIds].sort();
  if (
    actors.length < 2 ||
    actors.length > 65535 ||
    !actors.includes(scope.actorId) ||
    new Set(actors).size !== actors.length
  )
    throw createAppError('VALIDATION');
  for (const id of [scope.userId, scope.requestId, scope.actorId, ...actors])
    if (!idSchema.safeParse(id).success) throw createAppError('VALIDATION');
  return actors;
}
function currentMembers(fact: MessagingChannelFact | null): readonly string[] {
  if (!fact || fact.authority.kind !== 'private_group') return [];
  return [...fact.authority.activeMemberActorIds].sort();
}
function requireGroupFact(fact: MessagingChannelFact | null) {
  if (!fact || fact.policyKey !== 'social.private_group')
    throw createAppError('NOT_FOUND');
  return fact;
}
/** Authorization projection discovery precedes one ordered fence; receipt payload is read only after canonical allow. */
export function createMessagingGroupCreationStore(
  database: BunSQLDatabase,
  authorize: MessagingGroupCreationFence,
): MessagingGroupCreationStore {
  return {
    withCreation: (scope, work) => {
      const proposed = proposalActors(scope);
      return database.transaction(async (tx) => {
        const ownReceipt = and(
          eq(messagingSocialCommands.actorId, scope.actorId),
          eq(messagingSocialCommands.requestId, scope.requestId),
        );
        const [discovered] = await tx
          .select({
            kind: messagingSocialCommands.kind,
            channelId: messagingSocialCommands.resultChannelId,
          })
          .from(messagingSocialCommands)
          .where(ownReceipt);
        const fact =
          discovered?.kind === 'group.create' && discovered.channelId
            ? await readMessagingChannelFact(
                tx,
                discovered.channelId,
                scope.actorId,
              )
            : null;
        const accounts = await lockAuthorizationActors(
          tx,
          [...new Set([...proposed, ...currentMembers(fact)])].sort(),
          { maxActors: 65535 },
        );
        const contacts = fact
          ? []
          : await lockGroupContacts(tx, proposed, true);
        const creation = () =>
          authorize(tx, scope, { kind: 'create', accounts, contacts });
        let read = false,
          committed = false;
        const result = async () => {
          if (!discovered) {
            read = true;
            return null;
          }
          if (!fact || fact.authority.kind !== 'private_group') {
            await creation();
            throw createAppError('CONFLICT');
          }
          const locked = await tx.execute(
            sql`select public.daisy_messaging_channel_fence(${fact.channelId}::text,null::text,null::text) as locked`,
          );
          if (locked[0]?.locked !== true) throw createAppError('NOT_FOUND');
          const fresh = requireGroupFact(
            await readMessagingChannelFact(tx, fact.channelId, scope.actorId),
          );
          if (
            JSON.stringify(currentMembers(fresh)) !==
            JSON.stringify(currentMembers(fact))
          )
            throw createAppError('CONFLICT');
          await authorize(tx, scope, {
            kind: 'result',
            accounts,
            channel: fresh,
          });
          const [receipt] = await tx
            .select({
              kind: messagingSocialCommands.kind,
              digest: messagingSocialCommands.digest,
              channelId: messagingSocialCommands.resultChannelId,
            })
            .from(messagingSocialCommands)
            .where(ownReceipt);
          if (!receipt || receipt.channelId !== fresh.channelId)
            throw createAppError('NOT_FOUND');
          read = true;
          return {
            ...receipt,
            channelId: fresh.channelId,
            lifecycle: fresh.lifecycle,
          };
        };
        return work({
          authorize: creation,
          readResult: result,
          commit: async (command) => {
            if (!read || discovered || committed)
              throw createAppError('CONFLICT');
            await creation();
            const value = await writeMessagingGroupCreation(tx, scope, command);
            committed = true;
            return value;
          },
        });
      });
    },
  };
}
