import { groupCommandResultAllowed } from './authorization-group-result';
import { groupInvitationAllowed } from './authorization-invitation';
import { requestChannelDecision } from './authorization-request';
import { pendingFileCleanupAllowed } from './authorization-file';
import { contactSafetyAllowed } from './authorization-contact';
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
  GroupInvitationAuthorizationFact,
  GroupCommandResultAuthorizationFact,
} from './authorization-facts';
const deny = (
  reason: Extract<AuthorizationDecision, { allow: false }>['reason'],
): AuthorizationDecision => ({ allow: false, reason });
const allow: AuthorizationDecision = { allow: true };

const positiveRevision = (value: number) =>
  Number.isSafeInteger(value) && value > 0;
function validResourceKind(
  capability: AuthorizationCapability,
  resource: AuthorizationInput['resource'],
) {
  const specialized = {
    'channel.group.result': 'group_command_result',
    'channel.inbox.read': 'messaging_collection',
    'channel.file.cleanup': 'pending_file',
  } as const;
  const kind = specialized[capability as keyof typeof specialized];
  if (kind) return resource.kind === kind;
  if (capability.startsWith('channel.invitation.'))
    return resource.kind === 'group_invitation';
  if (capability === 'social.block') return resource.kind === 'contact_pair';
  if (
    ['social.request.create', 'channel.create.private_group'].includes(
      capability,
    )
  )
    return resource.kind === 'social_creation';
  if (capability.startsWith('foundation.'))
    return resource.kind === 'foundation';
  if (capability === 'round.read') return resource.kind === 'round';
  if (['room.create', 'room.list'].includes(capability))
    return resource.kind === 'room_collection';
  return (
    resource.kind === (capability.startsWith('room.') ? 'room' : 'channel')
  );
}
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
function roomDecision(
  actorId: string,
  capability: AuthorizationCapability,
  resource: RoomAuthorizationFact,
): AuthorizationDecision {
  const host = resource.hostActorId === actorId;
  const seated = resource.participants.some((p) => p.actorId === actorId);
  const readable =
    ['public', 'unlisted'].includes(resource.visibility) || host || seated;
  if (['room.read', 'room.join'].includes(capability))
    return readable ? allow : deny('missing-capability');
  if (capability === 'room.manage')
    return host ? allow : deny('missing-capability');
  return seated ? allow : deny('missing-capability');
}
function validDmAuthority(
  authority: Extract<ChannelAuthorizationFact['authority'], { kind: 'dm' }>,
) {
  return (
    positiveRevision(authority.revision) &&
    authority.lowActorId < authority.highActorId &&
    [authority.lowActorId, authority.highActorId].includes(
      authority.requestSenderActorId,
    )
  );
}
function validGroupAuthority(
  authority: Extract<
    ChannelAuthorizationFact['authority'],
    { kind: 'private_group' }
  >,
) {
  if (!['manager', 'member', null].includes(authority.role)) return false;
  if (!Number.isSafeInteger(authority.generation) || authority.generation < 0)
    return false;
  if (
    authority.role !== null &&
    (!positiveRevision(authority.generation) ||
      !authority.activeMemberActorIds.includes(authority.actorId))
  )
    return false;
  return (
    new Set(authority.activeMemberActorIds).size ===
    authority.activeMemberActorIds.length
  );
}
function validChannelAuthority(resource: ChannelAuthorizationFact) {
  if (!positiveRevision(resource.policyRevision)) return false;
  const authority = resource.authority;
  return authority.kind === 'dm'
    ? resource.policyKey === 'social.dm' && validDmAuthority(authority)
    : resource.policyKey === 'social.private_group' &&
        validGroupAuthority(authority);
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
    ['channel.read', 'channel.subscribe', 'channel.message.remove'].includes(
      capability,
    )
  )
    return allow;
  return channelMutation(capability, resource, context);
}
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
  if (principal.kind === 'service')
    return serviceDecision(principal, capability, resource);
  if (resource.kind === 'foundation') return deny('missing-capability');
  if (principal.kind !== 'user') return deny('unauthenticated');
  if (!boundMember(principal, context.account))
    return deny('missing-capability');
  return memberDecision(principal.actorId, capability, resource, context);
}
const decision = (allowed: boolean): AuthorizationDecision =>
  allowed ? allow : deny('missing-capability');
function resolveMemberResource(
  actorId: string,
  capability: AuthorizationCapability,
  resource: Exclude<AuthorizationInput['resource'], { kind: 'foundation' }>,
  context: AuthorizationInput['context'],
):
  | AuthorizationDecision
  | RoomAuthorizationFact
  | RoundAuthorizationFact
  | ChannelAuthorizationFact {
  switch (resource.kind) {
    case 'group_command_result':
      return decision(groupCommandResultAllowed(actorId, resource));
    case 'group_invitation':
      return decision(
        groupInvitationAllowed(actorId, capability, resource, context),
      );
    case 'pending_file':
      return decision(pendingFileCleanupAllowed(actorId, resource));
    case 'contact_pair':
      return decision(contactSafetyAllowed(actorId, resource, context));
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
  resource: Exclude<AuthorizationInput['resource'], { kind: 'foundation' }>,
  context: AuthorizationInput['context'],
): AuthorizationDecision {
  const resolved = resolveMemberResource(
    actorId,
    capability,
    resource,
    context,
  );
  if ('allow' in resolved) return resolved;
  if (!positiveRevision(resolved.revision)) return deny('denied');
  if (resolved.kind === 'round') return roundDecision(actorId, resolved);
  return resolved.kind === 'room'
    ? roomDecision(actorId, capability, resolved)
    : channelDecision(actorId, capability, resolved, context);
}

function roundDecision(
  actorId: string,
  resource: RoundAuthorizationFact,
): AuthorizationDecision {
  const readable =
    ['public', 'unlisted'].includes(resource.visibility) ||
    resource.createdByActorId === actorId ||
    resource.participants.some((p) => p.actorId === actorId);
  return readable ? allow : deny('missing-capability');
}
