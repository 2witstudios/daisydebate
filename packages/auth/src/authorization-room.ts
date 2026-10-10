import type {
  AuthorizationCapability,
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
export function roundReadable(
  actorId: string,
  resource: RoundAuthorizationFact,
): boolean {
  return (
    ['public', 'unlisted'].includes(resource.visibility) ||
    resource.createdByActorId === actorId ||
    resource.participants.some((p) => p.actorId === actorId)
  );
}
