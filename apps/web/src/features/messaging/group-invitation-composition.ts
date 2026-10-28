import type { Database } from '@daisy/db';
import type { MessagingGroupInvitationFence } from '@daisy/db/messaging';
import type {
  AuthorizationInput,
  AuthorizationPrincipal,
  SocialAccountFact,
  GroupInvitationAuthorizationFact,
  SocialCreationPolicy,
} from '@daisy/auth/authorization';
import type { Clock } from '@daisy/clock';
import { createAppError } from '@daisy/errors';
import { loadAccountPolicyFacts } from '../authorization/account-policy-facts';
import { requireAuthorization } from '@daisy/auth/request-authorization';
const capabilities = {
  read: 'channel.invitation.read',
  result: 'channel.invitation.result',
  accept: 'channel.invitation.accept',
  decline: 'channel.invitation.decline',
  cancel: 'channel.invitation.cancel',
} as const;
type FencedInvitation = Parameters<MessagingGroupInvitationFence>[3];
type InvitationFacts = {
  readonly invitation: FencedInvitation['invitation'];
  readonly accounts: readonly FencedInvitation['accounts'][number][];
};
/** The canonical invitation input over facts already read under the fences. */
export function groupInvitationAuthorizationInput(input: {
  readonly principal: AuthorizationPrincipal;
  readonly scope: { readonly userId: string; readonly actorId: string };
  readonly operation: keyof typeof capabilities;
  readonly facts: InvitationFacts;
  readonly now: string;
  readonly socialAccounts?: readonly SocialAccountFact[];
  readonly admissionPolicy?: SocialCreationPolicy;
}): AuthorizationInput {
  const { principal, scope, facts } = input;
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
  return {
    principal,
    capability: capabilities[input.operation],
    resource,
    context: {
      account:
        facts.accounts.find((row) => row?.actorId === scope.actorId) ?? null,
      contactAccounts: facts.accounts.filter(
        (row): row is NonNullable<typeof row> =>
          row !== null &&
          row.actorId !== null &&
          participants.includes(row.actorId),
      ),
      now: input.now,
      ...(input.socialAccounts === undefined
        ? {}
        : { socialAccounts: input.socialAccounts }),
      ...(input.admissionPolicy === undefined
        ? {}
        : { socialCreationPolicy: input.admissionPolicy }),
    },
  };
}
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
    const currentAccounts = facts.accounts.filter((row) => row !== null);
    const now = clock.now();
    const proposed = [
      ...facts.invitation.channel.activeMemberActorIds,
      facts.invitation.invitation.inviteeActorId,
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
    requireAuthorization(
      groupInvitationAuthorizationInput({
        principal,
        scope,
        operation,
        facts,
        now,
        ...(socialAccounts === undefined ? {} : { socialAccounts }),
        ...(admissionPolicy === undefined ? {} : { admissionPolicy }),
      }),
    );
  };
  return database.messagingGroupInvitationStore(authorize);
}
