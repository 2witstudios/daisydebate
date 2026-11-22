import { isDebatingSeat } from '@daisy/protocol/seats';
import { liveAudience } from './live-audience';
import type {
  AuthorizationCapability,
  RoomAuthorizationFact,
  RoundAuthorizationFact,
} from './authorization-facts';
/**
 * `room.read`, stated once: a public or unlisted Room is any member's to read;
 * a private Room is its host's and its seats' alone.
 */
export const roomReadable = (room: {
  readonly visibility: RoomAuthorizationFact['visibility'];
  readonly host: boolean;
  readonly seated: boolean;
}): boolean =>
  ['public', 'unlisted'].includes(room.visibility) || room.host || room.seated;
export function roomAllowed(
  actorId: string,
  capability: AuthorizationCapability,
  resource: RoomAuthorizationFact,
): boolean {
  const host = resource.hostActorId === actorId;
  const seated = resource.participants.some((p) => p.actorId === actorId);
  if (['room.read', 'room.join'].includes(capability))
    return roomReadable({ visibility: resource.visibility, host, seated });
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

/**
 * A seatless host acts as an event host, and a youth debater's linked adult
 * watches their Youth Round (ADR 0155); a seat gains nothing from either.
 */
const watchingAs = (actorId: string, resource: RoundAuthorizationFact) => {
  const audience = liveAudience(
    { ...resource, youth: resource.youth ?? null },
    { kind: 'account', actorId },
  );
  return audience.kind === 'undelayed_no_media' ? audience.as : null;
};

/** Delivered reports remain the debater's own content after paid access ends. */
export function roundAllowed(
  actorId: string,
  capability: AuthorizationCapability,
  resource: RoundAuthorizationFact,
): boolean {
  // A linked adult may see the Recording's transcript minutes later, so live
  // they read it too (ADR 0155); a seatless host never did.
  if (capability === 'round.transcript.read')
    return (
      seatedOn(actorId, resource) ||
      watchingAs(actorId, resource) === 'linked_adult'
    );
  if (capability === 'round.observe.undelayed')
    return watchingAs(actorId, resource) !== null;
  if (!capability.startsWith('round.analysis.'))
    return roundReadable(actorId, resource);
  return (
    resource.status === 'completed' &&
    resource.participants.some(
      (p) => p.actorId === actorId && isDebatingSeat(p.seat),
    )
  );
}
