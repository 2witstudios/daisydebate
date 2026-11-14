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

type EventOwner = Extract<RoomOwnerFact, { kind: 'event' }>;
export type EventRoomResource = (
  RoomAuthorizationFact | RoundAuthorizationFact
) & { readonly owner: EventOwner };

export const isEventRoom = (
  resource: RoomAuthorizationFact | RoundAuthorizationFact,
): resource is EventRoomResource => resource.owner?.kind === 'event';

/**
 * An event Room has no host person. Managing it and watching its Round
 * undelayed belong to everyone who holds `tournament.rooms.officiate` on
 * its fixture. Its seats read it; an official or an officiator not stopped
 * by a conflict reads it; anyone else reads it when its video is released
 * to them. Every other capability is the seat's own, as in any Room.
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
  if (capability === 'room.manage' || capability === 'round.observe.undelayed')
    return holdingDecision(officiates);
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
