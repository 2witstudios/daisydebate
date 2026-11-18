import type { CompetitionType } from '@daisy/protocol';

/**
 * Decision 79: ranked play is for members at or over the ranked age floor.
 * A Room rates when it is ranked (the Freestyle ladder) or a league Room on a
 * ladder; in such a Room a person under the floor holds no eligible seat, so
 * every seating path and Start refuse them under the same fenced read.
 */
type RatedRoomFacts = {
  readonly competitionType: CompetitionType;
  readonly leagueLadderId: string | null;
};

/** Whether a Room's Round would rate anyone: ranked, or on a league ladder. */
export const roomRates = (room: RatedRoomFacts): boolean =>
  room.competitionType === 'ranked' || room.leagueLadderId !== null;

/** Whether this actor's age lets them sit in this Room; a bot always may. */
export const rankedAgeSeatFits = (
  room: RatedRoomFacts,
  actor: { readonly kind: 'human' | 'bot'; readonly rankedAge: boolean },
): boolean => actor.kind !== 'human' || actor.rankedAge || !roomRates(room);

/** The same actor, ineligible for a seat its age keeps it from in this Room. */
export const seatableInRoom = <
  A extends {
    readonly kind: 'human' | 'bot';
    readonly rankedAge: boolean;
    readonly eligible: boolean;
  },
>(
  room: RatedRoomFacts,
  actor: A | null,
): A | null =>
  actor && {
    ...actor,
    eligible: actor.eligible && rankedAgeSeatFits(room, actor),
  };
