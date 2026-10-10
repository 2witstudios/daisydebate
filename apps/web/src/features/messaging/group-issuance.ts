import type { MessagingGroupOperationDependencies } from './group-operation';
import { messagingGroupResultView } from './group-result-view';
import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import type { MessagingGroupIssuanceStore } from '@daisy/db/messaging';
import { createAppError } from '@daisy/errors';
import { createMessagingSocialSchemas } from '@daisy/protocol';
import { parseValidated } from '../../server/http';
import { requireMessagingActor } from './principal';
import { messagingSocialDigest } from './social-command-digest';
export async function inviteMessagingGroup(
  input: unknown,
  principal: AuthorizationPrincipal,
  dependencies: MessagingGroupOperationDependencies & {
    readonly store: MessagingGroupIssuanceStore;
    readonly limits:
      | { readonly maxMembers: number; readonly maxPendingInvitations: number }
      | undefined;
  },
) {
  const actor = requireMessagingActor(principal);
  const command = parseValidated(
    createMessagingSocialSchemas(dependencies.bounds).inviteGroup,
    input,
  );
  const inviteeActorIds = [...command.invitedActorIds].sort();
  const digest = messagingSocialDigest('group.invite', [
    command.channelId,
    inviteeActorIds,
  ]);
  return dependencies.store.withIssuance(
    {
      ...actor,
      channelId: command.channelId,
      requestId: command.requestId,
      inviteeActorIds,
    },
    async (frame) => {
      const state = await frame.readResult();
      if (state.receipt) {
        if (
          state.receipt.kind !== 'group.invite' ||
          state.receipt.digest !== digest ||
          state.receipt.channelId !== command.channelId
        )
          throw createAppError('CONFLICT');
        return {
          version: 1 as const,
          channelId: command.channelId,
          lifecycle: state.lifecycle,
        };
      }
      if (!dependencies.limits) throw createAppError('INFRASTRUCTURE');
      await dependencies.limit(actor.actorId);
      const result = await frame.commit({
        ...dependencies.limits,
        digest,
        now: dependencies.clock.now(),
      });
      return messagingGroupResultView(
        { version: 1, ...result },
        command.channelId,
      );
    },
  );
}
