import { policyEvidenceCurrent as currentPolicy } from './authorization-policy';
import type { AuthorizationCapability } from '@daisy/protocol/authorization';
import type {
  AuthorizationDecision,
  AuthorizationInput,
  ChannelAuthorizationFact,
} from './authorization-facts';
const allow: AuthorizationDecision = { allow: true };
const deny = (_reason: 'missing-capability'): AuthorizationDecision => ({
  allow: false,
  reason: 'missing-capability',
});
const decision = (allowed: boolean): AuthorizationDecision =>
  allowed ? allow : deny('missing-capability');
export function requestChannelDecision(
  actorId: string,
  capability: AuthorizationCapability,
  resource: ChannelAuthorizationFact,
  context: AuthorizationInput['context'],
): AuthorizationDecision {
  if (capability === 'channel.request.status')
    return requestStatusDecision(actorId, resource, context);
  if (capability === 'channel.request.result')
    return requestResultDecision(actorId, resource, context);
  return requestDecision(actorId, capability, resource, context);
}
function requestResultDecision(
  actorId: string,
  resource: ChannelAuthorizationFact,
  context: AuthorizationInput['context'],
): AuthorizationDecision {
  const authority = resource.authority;
  return authority.kind === 'dm' &&
    authority.state !== 'pending' &&
    [authority.lowActorId, authority.highActorId].includes(actorId) &&
    currentPolicy(resource, context.socialReading, context)
    ? allow
    : deny('missing-capability');
}
function requestStatusDecision(
  actorId: string,
  resource: ChannelAuthorizationFact,
  context: AuthorizationInput['context'],
): AuthorizationDecision {
  const authority = resource.authority;
  return decision(
    authority.kind === 'dm' &&
      authority.state === 'pending' &&
      authority.requestSenderActorId === actorId &&
      currentPolicy(resource, context.socialReading, context),
  );
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
  return actorAllowed &&
    currentPolicy(
      resource,
      policy,
      context,
      capability !== 'channel.request.read',
    )
    ? allow
    : deny('missing-capability');
}
