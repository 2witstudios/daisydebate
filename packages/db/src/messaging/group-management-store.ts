import { and, eq } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import { messagingSocialCommands } from '../schema/messaging-social';
import { withLockedMessagingAuthority } from './authority-frame';
import { writeGroupManagement } from './group-management-write';
import type {
  MessagingGroupManagementFence,
  MessagingGroupManagementStore,
} from './group-management-contracts';

/** Actual own receipt and current account/cast facts share the mutation transaction. */
export function createMessagingGroupManagementStore({
  database,
  authorize,
}: {
  readonly database: BunSQLDatabase;
  readonly authorize: MessagingGroupManagementFence;
}): MessagingGroupManagementStore {
  return {
    withManagement(scope, work) {
      if (!idSchema.safeParse(scope.requestId).success)
        throw createAppError('VALIDATION');
      return database.transaction((tx) =>
        withLockedMessagingAuthority(
          tx,
          scope,
          async (authority) => {
            if (authority.fact.authority.kind !== 'private_group')
              throw createAppError('NOT_FOUND');
            const [receipt] = await tx
              .select({
                actorId: messagingSocialCommands.actorId,
                requestId: messagingSocialCommands.requestId,
                kind: messagingSocialCommands.kind,
                digest: messagingSocialCommands.digest,
                channelId: messagingSocialCommands.resultChannelId,
              })
              .from(messagingSocialCommands)
              .where(
                and(
                  eq(messagingSocialCommands.actorId, scope.actorId),
                  eq(messagingSocialCommands.requestId, scope.requestId),
                ),
              );
            const facts = {
              channel: authority.fact,
              accounts: authority.accounts,
              receipt: receipt ?? null,
            };
            let observedAbsent = false;
            return work({
              async readResult() {
                await authorize(tx, scope, facts);
                observedAbsent = receipt === undefined;
                return {
                  channelId: scope.channelId,
                  lifecycle: authority.fact.lifecycle,
                  receipt: receipt ?? null,
                };
              },
              async commit(command) {
                if (!observedAbsent) throw createAppError('CONFLICT');
                await authorize(tx, scope, facts);
                const result = await writeGroupManagement(
                  tx,
                  scope,
                  authority.fact,
                  command,
                );
                observedAbsent = false;
                return result;
              },
            });
          },
          {
            additionalActors:
              scope.targetActorId === undefined ? [] : [scope.targetActorId],
            beforeChannel: async () => {},
          },
        ),
      );
    },
  };
}
