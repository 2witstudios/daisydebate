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
function requestDecision(
  actorId: string,
  capability: AuthorizationCapability,
  resource: ChannelAuthorizationFact,
  context: AuthorizationInput['context'],
): AuthorizationDecision {
  const authority = resource.authority;
  if (
    authority.kind !== 'dm' ||
    authority.state !== 'pending' ||
    authority.blocked ||
    resource.lifecycle !== 'active' ||
    ![authority.lowActorId, authority.highActorId].includes(actorId)
  )
    return deny('missing-capability');
  const sender = authority.requestSenderActorId === actorId;
  const actorAllowed =
    capability === 'channel.request.cancel' ? sender : !sender;
  const policy =
    capability === 'channel.request.read'
      ? context.socialReading
      : context.socialPosting;
  return actorAllowed && currentPolicy(resource, policy, context)
    ? allow
    : deny('missing-capability');
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
    !currentPolicy(resource, context.socialPosting, context)
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
  if (capability.startsWith('channel.request.'))
    return requestDecision(actorId, capability, resource, context);
  if (
    !channelEntitlement(resource, actorId) ||
    !currentPolicy(resource, context.socialReading, context)
  )
    return deny('missing-capability');
  if (['channel.read', 'channel.subscribe'].includes(capability)) return allow;
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
function memberDecision(
  actorId: string,
  capability: AuthorizationCapability,
  resource: Exclude<AuthorizationInput['resource'], { kind: 'foundation' }>,
  context: AuthorizationInput['context'],
): AuthorizationDecision {
  if (resource.kind === 'room_collection') return allow;
  if (!positiveRevision(resource.revision)) return deny('denied');
  if (resource.kind === 'round') return roundDecision(actorId, resource);
  return resource.kind === 'room'
    ? roomDecision(actorId, capability, resource)
    : channelDecision(actorId, capability, resource, context);
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
