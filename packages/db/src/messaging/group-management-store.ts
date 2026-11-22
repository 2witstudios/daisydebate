import { groupLifecycleOf } from './social';
import { readMessagingGroupCommand } from './group-command-row';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol/primitives';
import { withLockedMessagingAuthority } from './authority-frame';
import { writeGroupManagement } from './group-management-write';
import type {
  MessagingGroupManagementFence,
  MessagingGroupManagementStore,
} from './group-management-contracts';
import { inTransaction, type TxSource } from '../tx';

/** Actual own receipt and current account/cast facts share the mutation transaction. */
export function createMessagingGroupManagementStore({
  database,
  authorize,
}: {
  readonly database: TxSource;
  readonly authorize: MessagingGroupManagementFence;
}): MessagingGroupManagementStore {
  return {
    withManagement(scope, work) {
      if (!idSchema.safeParse(scope.requestId).success)
        throw createAppError('VALIDATION');
      return inTransaction(database, (tx) =>
        withLockedMessagingAuthority(
          tx,
          scope,
          async (authority) => {
            if (authority.fact.authority.kind !== 'private_group')
              throw createAppError('NOT_FOUND');
            const receipt = await readMessagingGroupCommand(
              tx,
              scope.actorId,
              scope.requestId,
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
                  lifecycle: groupLifecycleOf(authority.fact.lifecycle),
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
