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
const seatedOn = (actorId: string, resource: RoundAuthorizationFact) =>
  resource.participants.some((p) => p.actorId === actorId);

/**
 * The live Round belongs to its seats and its host. Public and unlisted decide
 * who may watch the Broadcast, never who reads undelayed timing or outcome.
 */
const roundReadable = (actorId: string, resource: RoundAuthorizationFact) =>
  resource.createdByActorId === actorId || seatedOn(actorId, resource);

/** A seatless host acts as an event host; a seated host gains nothing from hosting. */
const undelayedObserver = (actorId: string, resource: RoundAuthorizationFact) =>
  resource.createdByActorId === actorId && !seatedOn(actorId, resource);

/** Delivered reports remain the debater's own content after paid access ends. */
export function roundAllowed(
  actorId: string,
  capability: AuthorizationCapability,
  resource: RoundAuthorizationFact,
  context: AuthorizationInput['context'],
): boolean {
  if (capability === 'round.transcript.read')
    return seatedOn(actorId, resource);
  if (capability === 'round.observe.undelayed')
    return undelayedObserver(actorId, resource);
  if (!capability.startsWith('round.analysis.'))
    return roundReadable(actorId, resource);
  return (
    (capability === 'round.analysis.read' ||
      context.entitlements?.roundAnalysis === true) &&
    resource.status === 'completed' &&
    resource.participants.some(
      (p) =>
        p.actorId === actorId && ['affirmative', 'negative'].includes(p.role),
    )
  );
}
