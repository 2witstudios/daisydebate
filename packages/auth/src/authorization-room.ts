import type {
  AuthorizationCapability,
  AuthorizationInput,
  RoomAuthorizationFact,
  RoundAuthorizationFact,
} from './authorization-facts';
export function roomAllowed(
  actorId: string,
  capability: AuthorizationCapability,
  resource: RoomAuthorizationFact,
): boolean {
  const host = resource.hostActorId === actorId;
  const seated = resource.participants.some((p) => p.actorId === actorId);
  if (['room.read', 'room.join'].includes(capability))
    return (
      ['public', 'unlisted'].includes(resource.visibility) || host || seated
    );
  return capability === 'room.manage' ? host : seated;
}
function roundReadable(
  actorId: string,
  resource: RoundAuthorizationFact,
): boolean {
  return (
    ['public', 'unlisted'].includes(resource.visibility) ||
    resource.createdByActorId === actorId ||
    resource.participants.some((p) => p.actorId === actorId)
  );
}

/** Coaching entitlement supplements participant admission and an own debating seat. */
export function roundAllowed(
  actorId: string,
  capability: AuthorizationCapability,
  resource: RoundAuthorizationFact,
  context: AuthorizationInput['context'],
): boolean {
  if (!capability.startsWith('round.coaching.'))
    return roundReadable(actorId, resource);
  return (
    context.entitlements?.coaching === true &&
    resource.status === 'completed' &&
    resource.participants.some(
      (p) =>
        p.actorId === actorId && ['affirmative', 'negative'].includes(p.role),
    )
  );
}
