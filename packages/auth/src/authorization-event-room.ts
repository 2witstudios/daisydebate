import type { AuthorizationCapability } from '@daisy/protocol/authorization';
import { audienceDecision } from './authorization-audience';
import { conflictOf, conflictRefusal } from './authorization-conflict';
import {
  allowRelated,
  allowUnder,
  decide,
  type AuthorizationDecision,
} from './authorization-decision';
import type {
  RoomAuthorizationFact,
  RoundAuthorizationFact,
} from './authorization-facts';
import { holdingDecision, holds, type Holder } from './authorization-holding';
import type { RoomOwnerFact } from './authorization-lobby-facts';
import { roundAllowed } from './authorization-room';
import { liveAudience } from './live-audience';

type EventOwner = Extract<RoomOwnerFact, { kind: 'event' }>;
export type EventRoomResource = (
  RoomAuthorizationFact | RoundAuthorizationFact
) & { readonly owner: EventOwner };

export const isEventRoom = (
  resource: RoomAuthorizationFact | RoundAuthorizationFact,
): resource is EventRoomResource => resource.owner?.kind === 'event';

/**
 * Without the officiating grant, a Youth event Round is watched undelayed by
 * its youth debaters' linked adults while it runs, the shared live rule's
 * `linked_adult` answer and nothing else (ADR 0155): an event Room has no
 * host person, so no seatless-host fallback applies.
 */
const linkedAdultDecision = (
  holder: Holder,
  round: RoundAuthorizationFact,
  officiates: ReturnType<typeof holds>,
): AuthorizationDecision => {
  const audience = liveAudience(
    { ...round, youth: round.youth ?? null },
    { kind: 'account', actorId: holder.actorId },
  );
  return audience.kind === 'undelayed_no_media' &&
    audience.as === 'linked_adult'
    ? decide(true)
    : holdingDecision(officiates);
};

/**
 * Watching an event Round undelayed: the officiating grant first, then a
 * Youth Round's linked adult.
 */
const observeDecision = (
  holder: Holder,
  resource: EventRoomResource,
  officiates: ReturnType<typeof holds>,
): AuthorizationDecision =>
  officiates.held || resource.kind !== 'round'
    ? holdingDecision(officiates)
    : linkedAdultDecision(holder, resource, officiates);

/**
 * An event Room has no host person. Managing it and watching its Round
 * undelayed belong to everyone who holds `tournament.rooms.officiate` on
 * its fixture; a Youth Round is also watched undelayed by its youth
 * debaters' linked adults while it runs (ADR 0155). Its seats read it; an
 * official or an officiator not stopped by a conflict reads it; anyone else
 * reads it when its video is released to them. Every other capability is
 * the seat's own, as in any Room.
 *
 * An officiator runs the Room, so for a guardian's video cap of `officials`
 * an officiator is an official: the cap never stops the people managing the
 * Room a ward is seated in from reading it.
 */
export function eventRoomDecision(
  holder: Holder,
  capability: AuthorizationCapability,
  resource: EventRoomResource,
): AuthorizationDecision {
  const owner = resource.owner;
  const officiates = holds(holder, 'tournament.rooms.officiate', {
    kind: 'lobby',
    scope: owner.scope,
  });
  if (capability === 'room.manage') return holdingDecision(officiates);
  if (capability === 'round.observe.undelayed')
    return observeDecision(holder, resource, officiates);
  const seated = resource.participants.some(
    (participant) => participant.actorId === holder.actorId,
  );
  if (capability !== 'room.read' && capability !== 'round.read')
    return decide(
      resource.kind === 'round'
        ? roundAllowed(holder.actorId, capability, resource)
        : seated,
    );
  if (seated) return allowRelated('seat');
  const conflict = conflictOf(resource);
  if (officiates.held && conflictRefusal(conflict) === null)
    return allowUnder(officiates.authority);
  return audienceDecision(
    holder,
    owner.scope,
    'video',
    owner.viewing,
    conflict,
    owner.video,
  );
}
