import { isJudgeSeat, sideOfSeat, type SeatRef } from '@daisy/protocol/seats';
import { isNamedSeat, type RoundView } from '@daisy/protocol/round-view';
import {
  seatName,
  sideName,
  sideShortName,
} from '../../features/debate-room/seat-names';
import { sideToneOf } from '../../features/debate-room/speeches';
import type { Seat } from '../../features/round-runtime/round-reading';
import { initialsOf } from '../../lib/initials';
import type { Debater, RoundPerson, SeatGroup } from './round';

/**
 * A Round's seats as the debater room reads them (TAB-6.17): every name and
 * colour from the format's own declared sides.
 */

type Participant = RoundView['participants'][number];
type Rules = RoundView['rules'];

export const debaterOf = (rules: Rules, p: Seat): Debater => {
  const side = sideOfSeat(p.seat);
  return {
    id: p.actorId,
    name: p.label,
    initials: initialsOf(p.label),
    seat: p.seat,
    side,
    sideLabel:
      side === null ? seatName(rules, p.seat) : sideName(rules.sides, side),
    sideShort:
      side === null
        ? seatName(rules, p.seat)
        : sideShortName(rules.sides, side),
    tone: sideToneOf(rules.sides, side),
    rating: null,
  };
};

/** The heading a seat is listed under. */
const groupKeyOf = (seat: SeatRef): string => {
  switch (seat.kind) {
    case 'side':
      return seat.side;
    case 'speaker':
    case 'moderator':
    case 'judge':
      return seat.kind;
  }
};

/** The Room tab's headings: each side in declared order, the speakers, the moderator, the judges. */
export const seatGroupsOf = (rules: Rules): readonly SeatGroup[] => [
  ...rules.sides.map((side) => ({
    key: side.key,
    title: side.label,
    judges: false,
  })),
  ...(rules.seats.speakers > 0
    ? [{ key: 'speaker', title: 'Speakers', judges: false }]
    : []),
  ...(rules.seats.moderators > 0
    ? [{ key: 'moderator', title: 'Moderator', judges: false }]
    : []),
  { key: 'judge', title: 'Judge', judges: true },
];

export const personOf = (p: Participant): RoundPerson => {
  const judge = isJudgeSeat(p.seat);
  const group = groupKeyOf(p.seat);
  if (!isNamedSeat(p))
    return {
      id: `judge-${p.seat.slot}`,
      name: 'Judge',
      group,
      judge,
      bot: false,
    };
  return {
    id: judge ? p.id : p.actorId,
    name: judge ? 'Judge' : p.label,
    group,
    judge,
    bot: p.kind === 'bot',
  };
};
