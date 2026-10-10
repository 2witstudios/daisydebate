import type { Database } from '@daisy/db';
import type { MessagingGroupManagementFence } from '@daisy/db/messaging';
import type {
  AuthorizationPrincipal,
  GroupCommandResultAuthorizationFact,
} from '@daisy/auth/authorization';
import type { SocialContactPolicy } from '@daisy/auth/social-policy';
import type { Clock } from '@daisy/clock';
import { createAppError } from '@daisy/errors';
import { requireMessagingAuthorization } from './authorization';
import { requireMessagingActor } from './principal';
import {
  messagingAuthorizationFence,
  type MessagingReadingPolicy,
} from './authorization-fence';
const capabilities = {
  remove: 'channel.group.revoke',
  leave: 'channel.leave',
  transfer: 'channel.manage',
  archive: 'channel.group.archive',
} as const;
/** Safety and committed-result checks deliberately require no age/content-policy loader. */
export function composeMessagingGroupManagementStore(input: {
  readonly database: Database;
  readonly principal: AuthorizationPrincipal;
  readonly clock: Clock;
  readonly postingPolicy: SocialContactPolicy;
  readonly readingPolicy: MessagingReadingPolicy;
}) {
  const authorize: MessagingGroupManagementFence = async (tx, scope, facts) => {
    const { principal } = input;
    const actor = requireMessagingActor(principal);
    if (actor.userId !== scope.userId || actor.actorId !== scope.actorId)
      throw createAppError('AUTHORIZATION');
    if (
      facts.channel.authority.kind !== 'private_group' ||
      facts.channel.policyKey !== 'social.private_group'
    )
      throw createAppError('AUTHORIZATION');
    if (facts.receipt) {
      const resource: GroupCommandResultAuthorizationFact = {
        kind: 'group_command_result',
        channel: {
          channelId: facts.channel.channelId,
          kind: 'private_group',
          policyKey: facts.channel.policyKey,
          policyRevision: facts.channel.policyRevision,
          revision: facts.channel.revision,
          lifecycle: facts.channel.lifecycle,
        },
        command: {
          actorId: facts.receipt.actorId,
          requestId: facts.receipt.requestId,
          kind: facts.receipt.kind,
          resultChannelId: facts.receipt.channelId ?? '',
        },
      };
      requireMessagingAuthorization({
        principal,
        capability: 'channel.group.result',
        resource,
        context: {
          account:
            facts.accounts.find((a) => a?.actorId === scope.actorId) ?? null,
        },
      });
      return;
    }
    if (scope.operation === 'transfer') {
      await messagingAuthorizationFence({
        ...input,
        capability: capabilities.transfer,
        groupPostingPolicy: input.postingPolicy,
      })(tx, scope, { fact: facts.channel, accounts: facts.accounts });
      return;
    }
    requireMessagingAuthorization({
      principal,
      capability: capabilities[scope.operation],
      resource: facts.channel,
      context: {
        account:
          facts.accounts.find((a) => a?.actorId === scope.actorId) ?? null,
      },
    });
  };
  return input.database.messagingGroupManagementStore(authorize);
}
