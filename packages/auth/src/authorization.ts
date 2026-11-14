export { subscriptionAccess, subscriptionGrants } from './subscription-policy';
export { canManageBilling, canPurchasePremium } from './billing-policy';
export { admitAllowance, canUseAiAllowance } from './allowance';
export { canReleaseFreeJudgeBinding } from './free-judge-binding';
import {
  allowFixed as allow,
  decide as decision,
  deny,
} from './authorization-decision';
import { admitsCapability } from './participant-access';
import { validResourceKind } from './authorization-resource-kind';
import { operatorDecision, operatorResource } from './authorization-operator';
export { accountEntitlements } from './account-entitlements';
import { validChannelAuthority } from './authorization-channel-validation';
import { reactionAssociationOwned } from './authorization-reaction';
import { preferenceClearAllowed } from './authorization-preferences';
import { roomAllowed, roundAllowed } from './authorization-room';
import { boundaryAdmits } from './authorization-boundary';
import { withConflict } from './authorization-conflict';
import { eventRoomDecision, isEventRoom } from './authorization-event-room';
import { holderOf } from './authorization-holding';
import { isLobbyResource, lobbyDecision } from './authorization-lobby';
import { groupInvitationCreationAllowed } from './authorization-group-invite';
import { groupSafetyAllowed } from './authorization-group-safety';
import { groupCommandResultAllowed } from './authorization-group-result';
import { groupInvitationAllowed } from './authorization-invitation';
import { requestChannelDecision } from './authorization-request';
import { pendingFileCleanupAllowed } from './authorization-file';
import { contactPairAllowed } from './authorization-contact';
import { socialCreationAllowed } from './authorization-creation';
import { policyEvidenceCurrent as currentPolicy } from './authorization-policy';
import {
  authorizationCapabilitySchema,
  type AuthorizationCapability,
} from '@daisy/protocol/authorization';
import type {
  AuthorizationPrincipal,
  AccountAuthorizationFact,
  RoomAuthorizationFact,
  RoundAuthorizationFact,
  ChannelAuthorizationFact,
  AuthorizationInput,
  AuthorizationDecision,
} from './authorization-facts';
export {
  ADMITTED_AGE_BANDS,
  admitsPrincipalAccess,
  ageAdmitted,
  participantAccess,
} from './participant-access';
export type { ContactPairCapability } from './authorization-contact';
export {
  boundaryFilter,
  insideBoundary,
  type BoundaryFilter,
} from './authorization-boundary';
export type {
  AuthorityRelation,
  Conflict,
  DecisionAuthority,
} from './authorization-decision';
export type {
  BoundaryFact,
  ConflictFact,
  CounterpartFact,
  GrantFact,
  LobbyAuthorizationFact,
  LobbyResourceFact,
  LobbyScopeFact,
  OrganizationAuthorizationFact,
  RoleGivenFact,
  RoomOwnerFact,
  TournamentScopeFact,
  VideoSubjectsFact,
  ViewerAudience,
  ViewingFact,
} from './authorization-lobby-facts';
export type {
  AuthorizationPrincipal,
  AuthorizationCapability,
  AccountAuthorizationFact,
  RoomAuthorizationFact,
  RoundAuthorizationFact,
  ChannelAuthorizationFact,
  AuthorizationInput,
  AuthorizationDecision,
  SocialPolicyEvidence,
  SocialAccountFact,
  SocialCreationFact,
  SocialCreationPolicy,
  ContactAuthorizationFact,
  ContactPairAuthorizationFact,
  PendingFileAuthorizationFact,
  MessagingCollectionAuthorizationFact,
  MessagingPreferenceAuthorizationFact,
  MessagingReactionAuthorizationFact,
  GroupInvitationAuthorizationFact,
  GroupCommandResultAuthorizationFact,
  GroupInvitationCreationAuthorizationFact,
} from './authorization-facts';
const positiveRevision = (value: number) =>
  Number.isSafeInteger(value) && value > 0;
type UserPrincipal = Extract<AuthorizationPrincipal, { kind: 'user' }>;
function boundMember(
  principal: UserPrincipal,
  account: AccountAuthorizationFact | null,
): principal is UserPrincipal & { actorId: string } {
  return (
    account !== null &&
    account.userId === principal.userId &&
    account.actorId === principal.actorId &&
    account.member &&
    principal.actorId !== null &&
    positiveRevision(account.revision)
  );
}
function channelEntitlement(
  resource: ChannelAuthorizationFact,
  actorId: string,
) {
  const authority = resource.authority;
  return authority.kind === 'dm'
    ? authority.state === 'accepted' &&
        [authority.lowActorId, authority.highActorId].includes(actorId)
    : authority.actorId === actorId && authority.role !== null;
}
function channelMutation(
  capability: AuthorizationCapability,
  resource: ChannelAuthorizationFact,
  context: AuthorizationInput['context'],
): AuthorizationDecision {
  if (
    resource.lifecycle !== 'active' ||
    !currentPolicy(resource, context.socialPosting, context, true)
  )
    return deny('missing-capability');
  const authority = resource.authority;
  if (capability === 'channel.manage')
    return authority.kind === 'private_group' && authority.role === 'manager'
      ? allow
      : deny('missing-capability');
  return authority.kind === 'dm' && authority.blocked
    ? deny('missing-capability')
    : allow;
}
function channelDecision(
  actorId: string,
  capability: AuthorizationCapability,
  resource: ChannelAuthorizationFact,
  context: AuthorizationInput['context'],
): AuthorizationDecision {
  if (!validChannelAuthority(resource)) return deny('denied');
  // DEC-126: a retained DM is its survivor's own rows, read only through
  // channel.retained.read; every channel capability refuses it.
  if (resource.lifecycle === 'retained') return deny('missing-capability');
  if (['channel.group.revoke', 'channel.group.archive'].includes(capability))
    return decision(groupSafetyAllowed(actorId, capability, resource));
  if (capability === 'channel.leave')
    return decision(
      resource.authority.kind === 'private_group' &&
        channelEntitlement(resource, actorId),
    );
  if (capability.startsWith('channel.request.'))
    return requestChannelDecision(actorId, capability, resource, context);
  if (
    !channelEntitlement(resource, actorId) ||
    !currentPolicy(resource, context.socialReading, context)
  )
    return deny('missing-capability');
  // Removal still requires the operation's own-author check; this grant is not a content read or edit.
  if (
    [
      'channel.read',
      'channel.subscribe',
      'channel.message.remove',
      'channel.reaction.remove',
      'channel.preferences.read',
      'channel.preferences.update',
    ].includes(capability)
  )
    return allow;
  return channelMutation(capability, resource, context);
}
/**
 * Requests a service principal answers, or that address operator
 * resources (ADR 0079); null routes the request to the member decision.
 */
function serviceRoute(
  principal: AuthorizationPrincipal,
  capability: AuthorizationCapability,
  resource: AuthorizationInput['resource'],
  context: AuthorizationInput['context'],
): AuthorizationDecision | null {
  if (principal.kind === 'operator_service' || operatorResource(resource))
    return operatorDecision(principal, capability, context);
  return principal.kind === 'service'
    ? serviceDecision(principal, capability, resource)
    : null;
}
const nonMemberResource = (
  resource: AuthorizationInput['resource'],
): resource is Extract<
  AuthorizationInput['resource'],
  {
    kind:
      | 'foundation'
      | 'account'
      | 'account_collection'
      | 'content_moderation'
      | 'flag_control';
  }
> => resource.kind === 'foundation' || operatorResource(resource);
function serviceDecision(
  principal: Extract<AuthorizationPrincipal, { kind: 'service' }>,
  capability: AuthorizationCapability,
  resource: AuthorizationInput['resource'],
): AuthorizationDecision {
  return resource.kind === 'foundation' &&
    principal.scope === 'foundation' &&
    principal.capabilities.includes(capability)
    ? allow
    : deny('missing-capability');
}
/** The sole pure decision. Load under producer locks and reevaluate after waits. */
export function authorize(input: AuthorizationInput): AuthorizationDecision {
  const { capability, resource } = input;
  if (
    !authorizationCapabilitySchema.safeParse(capability).success ||
    !validResourceKind(capability, resource)
  )
    return deny('denied');
  // Every answer about a fixture's resource carries the conflict, a deny
  // made before the member's own rule included.
  return withConflict(capability, resource, askedDecision(input));
}
function askedDecision({
  principal,
  capability,
  resource,
  context,
}: AuthorizationInput): AuthorizationDecision {
  if (context.account?.erased) return deny('account-erased');
  const serviceRouted = serviceRoute(principal, capability, resource, context);
  if (serviceRouted) return serviceRouted;
  if (nonMemberResource(resource)) return deny('missing-capability');
  if (principal.kind !== 'user') return deny('unauthenticated');
  if (!admittedMember(principal, capability, context.account))
    return deny('missing-capability');
  if (!boundaryAdmits(principal.actorId, capability, resource, context))
    return deny('restricted');
  return unconflictedDecision(principal.actorId, capability, resource, context);
}
/**
 * A bound member holds a capability only with participant access (ADR
 * 0075), except the withdrawals every member keeps.
 */
function admittedMember(
  principal: UserPrincipal,
  capability: AuthorizationCapability,
  account: AccountAuthorizationFact | null,
): principal is UserPrincipal & { actorId: string } {
  return (
    boundMember(principal, account) && admitsCapability(capability, account)
  );
}
function resolveMemberResource(
  actorId: string,
  capability: AuthorizationCapability,
  resource: Exclude<
    AuthorizationInput['resource'],
    {
      kind:
        | 'foundation'
        | 'account'
        | 'account_collection'
        | 'content_moderation'
        | 'flag_control'
        | 'channel_reaction'
        | 'member_history'
        | import('./authorization-lobby-facts').LobbyResourceFact['kind'];
    }
  >,
  context: AuthorizationInput['context'],
):
  | AuthorizationDecision
  | RoomAuthorizationFact
  | RoundAuthorizationFact
  | ChannelAuthorizationFact {
  switch (resource.kind) {
    case 'channel_preference':
      return decision(preferenceClearAllowed(actorId, resource));
    case 'group_invitation_creation':
      return decision(
        groupInvitationCreationAllowed(actorId, resource, context),
      );
    case 'group_command_result':
      return decision(groupCommandResultAllowed(actorId, resource));
    case 'group_invitation':
      return decision(
        groupInvitationAllowed(actorId, capability, resource, context),
      );
    case 'pending_file':
      return decision(pendingFileCleanupAllowed(actorId, resource));
    case 'contact_pair':
      return decision(
        contactPairAllowed(actorId, capability, resource, context),
      );
    case 'social_creation':
      return decision(
        socialCreationAllowed(actorId, capability, resource, context),
      );
    case 'messaging_collection':
    case 'friend_collection':
    case 'challenge_collection':
    case 'people_list':
    case 'rating_visibility':
    case 'moderation_notice':
    case 'presence_setting':
      return decision(resource.actorId === actorId);
    case 'room_collection':
      return allow;
    case 'round':
    case 'room':
    case 'channel':
    default:
      return resource;
  }
}
type MemberResource = Exclude<
  AuthorizationInput['resource'],
  {
    kind:
      | 'foundation'
      | 'account'
      | 'account_collection'
      | 'content_moderation'
      | 'flag_control';
  }
>;
/**
 * The answer to a held command's own question, asked for the person
 * confirming it. A held command is a stored row: a capability the
 * vocabulary no longer names is denied, and a minor's boundary bounds it
 * like any other question.
 */
function heldDecision(
  actorId: string,
  held: AuthorizationCapability,
  target: MemberResource,
  context: AuthorizationInput['context'],
): AuthorizationDecision {
  if (
    !authorizationCapabilitySchema.safeParse(held).success ||
    !validResourceKind(held, target)
  )
    return deny('denied');
  return withConflict(
    held,
    target,
    boundaryAdmits(actorId, held, target, context)
      ? unconflictedDecision(actorId, held, target, context)
      : deny('restricted'),
  );
}
function unconflictedDecision(
  actorId: string,
  capability: AuthorizationCapability,
  resource: MemberResource,
  context: AuthorizationInput['context'],
): AuthorizationDecision {
  // A member's private history is theirs alone (ISSUE-600).
  if (resource.kind === 'member_history')
    return decision(resource.actorId === actorId);
  if (isLobbyResource(resource))
    return lobbyDecision(
      holderOf(actorId, context),
      capability,
      resource,
      context,
      (held, target) => heldDecision(actorId, held, target, context),
    );
  if (resource.kind === 'channel_reaction') {
    if (
      !reactionAssociationOwned(actorId, resource) ||
      !positiveRevision(resource.channel.revision)
    )
      return deny('missing-capability');
    return channelDecision(actorId, capability, resource.channel, context);
  }
  const resolved = resolveMemberResource(
    actorId,
    capability,
    resource,
    context,
  );
  if ('allow' in resolved) return resolved;
  if (!positiveRevision(resolved.revision)) return deny('denied');
  if (resolved.kind === 'channel')
    return channelDecision(actorId, capability, resolved, context);
  if (isEventRoom(resolved))
    return eventRoomDecision(holderOf(actorId, context), capability, resolved);
  return decision(
    resolved.kind === 'round'
      ? roundAllowed(actorId, capability, resolved)
      : roomAllowed(actorId, capability, resolved),
  );
}
