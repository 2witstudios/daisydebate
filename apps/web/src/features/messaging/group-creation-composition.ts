import type { Database } from '@daisy/db';
import type { MessagingGroupCreationFence } from '@daisy/db/messaging';
import type {
  AuthorizationPrincipal,
  SocialCreationPolicy,
} from '@daisy/auth/authorization';
import type { SocialContactPolicy } from '@daisy/auth/social-policy';
import type { Clock } from '@daisy/clock';
import { createAppError } from '@daisy/errors';
import { loadAccountPolicyFacts } from '../authorization/account-policy-facts';
import { requireMessagingAuthorization } from './authorization';
import { creationResource } from './social-authorization';
import {
  messagingAuthorizationFence,
  type MessagingReadingPolicy,
} from './authorization-fence';
export function composeMessagingGroupCreationStore(input: {
  readonly database: Database;
  readonly principal: AuthorizationPrincipal;
  readonly clock: Clock;
  readonly creationPolicy?: SocialCreationPolicy;
  readonly postingPolicy: SocialContactPolicy;
  readonly readingPolicy: MessagingReadingPolicy;
}) {
  const authorize: MessagingGroupCreationFence = async (tx, scope, facts) => {
    const { principal } = input;
    if (
      principal.kind !== 'user' ||
      principal.actorId !== scope.actorId ||
      principal.userId !== scope.userId
    )
      throw createAppError('AUTHORIZATION');
    if (facts.kind === 'result') {
      const channel = facts.channel;
      if (channel.authority.kind !== 'private_group')
        throw createAppError('AUTHORIZATION');
      const members = channel.authority.activeMemberActorIds;
      await messagingAuthorizationFence({
        ...input,
        capability: 'channel.read',
      })(
        tx,
        { ...scope, channelId: channel.channelId },
        {
          fact: channel,
          accounts: facts.accounts.filter(
            (row) =>
              row?.actorId !== null &&
              row?.actorId !== undefined &&
              members.includes(row.actorId),
          ),
        },
      );
      return;
    }
    if (!input.creationPolicy) throw createAppError('INFRASTRUCTURE');
    const now = input.clock.now();
    const accounts = facts.accounts.filter(
      (row) =>
        row?.actorId !== null &&
        row?.actorId !== undefined &&
        scope.proposedActorIds.includes(row.actorId),
    );
    const socialAccounts = await loadAccountPolicyFacts(tx, accounts, now);
    requireMessagingAuthorization({
      principal,
      capability: 'channel.create.private_group',
      resource: creationResource(
        { kind: 'private_group', policy: input.creationPolicy },
        scope.actorId,
        scope.proposedActorIds,
        facts.contacts,
        scope.policyRevision,
      ),
      context: {
        account:
          facts.accounts.find((row) => row?.actorId === scope.actorId) ?? null,
        now,
        socialAccounts,
        socialCreationPolicy: input.creationPolicy,
      },
    });
  };
  return input.database.messagingGroupCreationStore(authorize);
}
