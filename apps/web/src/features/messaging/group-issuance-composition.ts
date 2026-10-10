import type { Database } from '@daisy/db';
import type { MessagingGroupIssuanceFence } from '@daisy/db/messaging';
import type {
  AuthorizationPrincipal,
  GroupInvitationCreationAuthorizationFact,
  SocialCreationPolicy,
} from '@daisy/auth/authorization';
import type { Clock } from '@daisy/clock';
import { createAppError } from '@daisy/errors';
import { loadAccountPolicyFacts } from '../authorization/account-policy-facts';
import { requireMessagingActor } from './principal';
import { requireMessagingAuthorization } from './authorization';
import { requireMessagingGroupResult } from './group-command-result';
/** Actual cast plus proposed accounts are fenced in the exact same persistence transaction. */
export function composeMessagingGroupIssuanceStore(input: {
  readonly database: Database;
  readonly principal: AuthorizationPrincipal;
  readonly clock: Clock;
  readonly policy: SocialCreationPolicy | undefined;
}) {
  const authorize: MessagingGroupIssuanceFence = async (tx, scope, facts) => {
    const actor = requireMessagingActor(input.principal);
    if (actor.actorId !== scope.actorId || actor.userId !== scope.userId)
      throw createAppError('AUTHORIZATION');
    if (facts.receipt) {
      requireMessagingGroupResult(input.principal, facts);
      return;
    }
    if (!input.policy) throw createAppError('INFRASTRUCTURE');
    const now = input.clock.now();
    const socialAccounts = await loadAccountPolicyFacts(
      tx,
      facts.accounts,
      now,
    );
    const resource: GroupInvitationCreationAuthorizationFact = {
      kind: 'group_invitation_creation',
      channel: facts.channel,
      inviteeActorIds: scope.inviteeActorIds,
      contactPairs: facts.contactPairs,
    };
    requireMessagingAuthorization({
      principal: input.principal,
      capability: 'channel.group.invite',
      resource,
      context: {
        account:
          facts.accounts.find((row) => row?.actorId === actor.actorId) ?? null,
        now,
        socialAccounts,
        socialCreationPolicy: input.policy,
      },
    });
  };
  return input.database.messagingGroupIssuanceStore(authorize);
}
