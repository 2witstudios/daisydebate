import { groupLifecycleOf } from './social';
import { readMessagingGroupCommand } from './group-command-row';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol/primitives';
import { withLockedMessagingAuthority } from './authority-frame';
import { lockGroupContacts } from './group-contact-locks';
import { writeGroupIssuance } from './group-issuance-write';
import type {
  MessagingGroupIssuanceFence,
  MessagingGroupIssuanceStore,
} from './group-issuance-contracts';
import { inTransaction, type TxSource } from '../tx';
type Facts = Parameters<MessagingGroupIssuanceFence>[2];
/** Prospective pairs precede the channel fence; committed replay never materializes them. */
export function createMessagingGroupIssuanceStore(input: {
  readonly database: TxSource;
  readonly authorize: MessagingGroupIssuanceFence;
}): MessagingGroupIssuanceStore {
  return {
    withIssuance(scope, work) {
      if (
        !idSchema.safeParse(scope.requestId).success ||
        scope.inviteeActorIds.length === 0 ||
        new Set(scope.inviteeActorIds).size !== scope.inviteeActorIds.length
      )
        throw createAppError('VALIDATION');
      return inTransaction(input.database, async (tx) => {
        let receipt: Facts['receipt'] = null;
        let contactPairs: Facts['contactPairs'] = [];
        return withLockedMessagingAuthority(
          tx,
          scope,
          async (authority) => {
            if (authority.fact.authority.kind !== 'private_group')
              throw createAppError('NOT_FOUND');
            const facts = {
              channel: authority.fact,
              accounts: authority.accounts,
              receipt,
              contactPairs,
            };
            let observedAbsent = false;
            return work({
              async readResult() {
                await input.authorize(tx, scope, facts);
                observedAbsent = receipt === null;
                return {
                  channelId: scope.channelId,
                  lifecycle: groupLifecycleOf(authority.fact.lifecycle),
                  receipt:
                    receipt === null
                      ? null
                      : {
                          kind: receipt.kind,
                          digest: receipt.digest,
                          channelId: receipt.channelId,
                        },
                };
              },
              async commit(command) {
                if (!observedAbsent) throw createAppError('CONFLICT');
                await input.authorize(tx, scope, facts);
                const result = await writeGroupIssuance(
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
            additionalActors: scope.inviteeActorIds,
            beforeChannel: async (frame) => {
              if (frame.fact.authority.kind !== 'private_group')
                throw createAppError('NOT_FOUND');
              const row = await readMessagingGroupCommand(
                tx,
                scope.actorId,
                scope.requestId,
              );
              receipt = row ?? null;
              if (receipt === null)
                contactPairs = await lockGroupContacts(
                  tx,
                  [
                    ...frame.fact.authority.activeMemberActorIds,
                    ...scope.inviteeActorIds,
                  ],
                  true,
                );
            },
          },
        );
      });
    },
  };
}
