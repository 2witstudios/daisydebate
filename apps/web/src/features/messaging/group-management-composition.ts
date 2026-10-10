import { requireMessagingGroupResult } from './group-command-result';
import type { Database } from '@daisy/db';
import type { MessagingGroupManagementFence } from '@daisy/db/messaging';
import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
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
      requireMessagingGroupResult(principal, facts);
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
