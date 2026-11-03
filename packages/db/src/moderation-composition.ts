import { endMemberOffers } from './challenges/frame';
import type { ModerationReactions } from './moderation/store';
import {
  releaseMemberFromRooms,
  type RoomReleaseRules,
} from './room-restriction-release';
import {
  forfeitMemberRounds,
  type RoundForfeitRule,
} from './round-restriction-forfeit';

/** The engine's rules a restriction applies; the db never imports the engine. */
export type RestrictionRules = RoomReleaseRules & {
  readonly forfeitRound: RoundForfeitRule;
};

/**
 * What each capability registers to react to a restriction (ADR 0103). Rounds
 * come before Rooms: a Round's writers lock it before they touch its Room.
 */
export const moderationReactions = (
  rules: RestrictionRules,
): ModerationReactions => ({
  onRestricted: [
    endMemberOffers,
    (tx, actorId, { nextId, eventSink }) =>
      forfeitMemberRounds(tx, actorId, {
        nextId,
        eventSink,
        forfeit: rules.forfeitRound,
      }),
    (tx, actorId, { now }) =>
      releaseMemberFromRooms(tx, actorId, { now, rules }),
  ],
});
