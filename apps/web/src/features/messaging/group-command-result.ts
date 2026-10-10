import type {
  AuthorizationPrincipal,
  GroupCommandResultAuthorizationFact,
} from '@daisy/auth/authorization';
import type { MessagingGroupManagementFence } from '@daisy/db/messaging';
import { createAppError } from '@daisy/errors';
import { requireMessagingAuthorization } from './authorization';
/** The committed owner row grants only its minimal result, never membership or content. */
export function requireMessagingGroupResult(
  principal: AuthorizationPrincipal,
  facts: Parameters<MessagingGroupManagementFence>[2],
) {
  const { channel, receipt } = facts;
  if (
    !receipt ||
    channel.authority.kind !== 'private_group' ||
    channel.policyKey !== 'social.private_group'
  )
    throw createAppError('AUTHORIZATION');
  const resource: GroupCommandResultAuthorizationFact = {
    kind: 'group_command_result',
    channel: {
      channelId: channel.channelId,
      kind: 'private_group',
      policyKey: channel.policyKey,
      policyRevision: channel.policyRevision,
      revision: channel.revision,
      lifecycle: channel.lifecycle,
    },
    command: {
      actorId: receipt.actorId,
      requestId: receipt.requestId,
      kind: receipt.kind,
      resultChannelId: receipt.channelId ?? '',
    },
  };
  requireMessagingAuthorization({
    principal,
    capability: 'channel.group.result',
    resource,
    context: {
      account:
        facts.accounts.find((row) => row?.actorId === receipt.actorId) ?? null,
    },
  });
}
