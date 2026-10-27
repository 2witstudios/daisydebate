import { admitsCapability } from './participant-access';
import { validResourceKind } from './authorization-resource-kind';
import { operatorDecision, operatorResource } from './authorization-operator';
export { accountEntitlements, aiRoundAllowance } from './account-entitlements';
import { validChannelAuthority } from './authorization-channel-validation';
import { reactionAssociationOwned } from './authorization-reaction';
import { preferenceClearAllowed } from './authorization-preferences';
import { roomAllowed, roundAllowed } from './authorization-room';
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
  admitsPrincipalAccess,
  ageAdmitted,
  participantAccess,
} from './participant-access';
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
const deny = (
  reason: Extract<AuthorizationDecision, { allow: false }>['reason'],
): AuthorizationDecision => ({ allow: false, reason });
const allow: AuthorizationDecision = { allow: true };

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
  { kind: 'foundation' | 'account' | 'account_collection' }
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
export function authorize({
  principal,
  capability,
  resource,
  context,
}: AuthorizationInput): AuthorizationDecision {
  if (
    !authorizationCapabilitySchema.safeParse(capability).success ||
    !validResourceKind(capability, resource)
  )
    return deny('denied');
  if (context.account?.erased) return deny('account-erased');
  const serviceRouted = serviceRoute(principal, capability, resource, context);
  if (serviceRouted) return serviceRouted;
  if (nonMemberResource(resource)) return deny('missing-capability');
  if (principal.kind !== 'user') return deny('unauthenticated');
  if (!admittedMember(principal, capability, context.account))
    return deny('missing-capability');
  return memberDecision(principal.actorId, capability, resource, context);
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
const decision = (allowed: boolean): AuthorizationDecision =>
  allowed ? allow : deny('missing-capability');
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
        | 'channel_reaction'
        | 'member_history';
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
      return decision(resource.actorId === actorId);
    case 'room_collection':
      return allow;
    default:
      return resource;
  }
}
function memberDecision(
  actorId: string,
  capability: AuthorizationCapability,
  resource: Exclude<
    AuthorizationInput['resource'],
    { kind: 'foundation' | 'account' | 'account_collection' }
  >,
  context: AuthorizationInput['context'],
): AuthorizationDecision {
  // A member's private history is theirs alone (ISSUE-600).
  if (resource.kind === 'member_history')
    return decision(resource.actorId === actorId);
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
  if (resolved.kind === 'round')
    return decision(roundAllowed(actorId, capability, resolved, context));
  return resolved.kind === 'room'
    ? decision(roomAllowed(actorId, capability, resolved))
    : channelDecision(actorId, capability, resolved, context);
}
