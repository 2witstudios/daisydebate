import type { Database } from '@daisy/db';
import type { MessagingGroupInvitationFence } from '@daisy/db/messaging';
import type {
  AuthorizationPrincipal,
  GroupInvitationAuthorizationFact,
  SocialCreationPolicy,
} from '@daisy/auth/authorization';
import type { Clock } from '@daisy/clock';
import { createAppError } from '@daisy/errors';
import { loadAccountPolicyFacts } from '../authorization/account-policy-facts';
import { requireMessagingAuthorization } from './authorization';
const capabilities = {
  read: 'channel.invitation.read',
  result: 'channel.invitation.result',
  accept: 'channel.invitation.accept',
  decline: 'channel.invitation.decline',
  cancel: 'channel.invitation.cancel',
} as const;
/** One canonical evaluator, minimal refusal/result facts, and no admission prerequisite for declining. */
export function composeMessagingGroupInvitationStore({
  database,
  principal,
  clock,
  admissionPolicy,
}: {
  readonly database: Database;
  readonly principal: AuthorizationPrincipal;
  readonly clock: Clock;
  readonly admissionPolicy?: SocialCreationPolicy;
}) {
  const authorize: MessagingGroupInvitationFence = async (
    tx,
    scope,
    operation,
    facts,
  ) => {
    if (
      principal.kind !== 'user' ||
      principal.userId !== scope.userId ||
      principal.actorId !== scope.actorId
    )
      throw createAppError('AUTHORIZATION');
    const resource: GroupInvitationAuthorizationFact = facts.invitation;
    const participants = [
      resource.invitation.inviterActorId,
      resource.invitation.inviteeActorId,
    ];
    const currentAccounts = facts.accounts.filter((row) => row !== null);
    const contactAccounts = currentAccounts.filter(
      (row) => row.actorId !== null && participants.includes(row.actorId),
    );
    const now = clock.now();
    const proposed = [
      ...resource.channel.activeMemberActorIds,
      resource.invitation.inviteeActorId,
    ];
    const socialAccounts =
      operation === 'accept'
        ? await loadAccountPolicyFacts(
            tx,
            currentAccounts.filter(
              (row) => row.actorId !== null && proposed.includes(row.actorId),
            ),
            now,
          )
        : undefined;
    requireMessagingAuthorization({
      principal,
      capability: capabilities[operation],
      resource,
      context: {
        account:
          facts.accounts.find((row) => row?.actorId === scope.actorId) ?? null,
        contactAccounts,
        now,
        ...(socialAccounts === undefined ? {} : { socialAccounts }),
        ...(admissionPolicy === undefined
          ? {}
          : { socialCreationPolicy: admissionPolicy }),
      },
    });
  };
  return database.messagingGroupInvitationStore(authorize);
}
