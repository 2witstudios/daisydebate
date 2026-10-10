import type { ChannelAuthorizationFact } from './authorization-facts';
const positiveRevision = (value: number) =>
  Number.isSafeInteger(value) && value > 0;
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
export function validChannelAuthority(resource: ChannelAuthorizationFact) {
  if (!positiveRevision(resource.policyRevision)) return false;
  const authority = resource.authority;
  return authority.kind === 'dm'
    ? resource.policyKey === 'social.dm' && validDmAuthority(authority)
    : resource.policyKey === 'social.private_group' &&
        validGroupAuthority(authority);
}
