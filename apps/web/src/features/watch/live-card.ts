import type { LiveBroadcastPage } from '@daisy/db';
import { releasedStage } from '@daisy/debate-engine';
import {
  everySeatOf,
  isDebatingSeat,
  sameSeat,
  sideOfSeat,
  type Ladder,
  type SeatRef,
} from '@daisy/protocol';
import { seatName, sideShortName } from '../debate-room/seat-names';
import { modeLabel } from './labels';
import { liveHref } from './routes';

type LiveRow = LiveBroadcastPage['rows'][number];

type CardSeat = {
  /** The side's short name ('Aff'), or an unsided seat's name. */
  readonly label: string;
  /** `@name` for a person, a bot's own name; null when no name was ever claimed. */
  readonly name: string | null;
  readonly speaking: boolean;
};

/** One live Round as the Live listing shows it, from released facts alone. */
export type LiveCard = {
  readonly id: string;
  readonly href: string;
  readonly title: string;
  readonly ranked: boolean;
  /** The ladder a ranked Round rates on, shown beside Ranked; null for casual. */
  readonly ladder: Ladder | null;
  readonly mode: string;
  readonly resolution: string | null;
  /** One per side in declared order, or one per seat for an unsided format. */
  readonly seats: readonly CardSeat[];
  readonly phaseName: string;
  /** The clock as the released video shows it; null off the floor. */
  readonly secondsLeft: number | null;
  /** One step per speech: finished, in progress or still to come. */
  readonly progress: readonly ('done' | 'current' | 'upcoming')[];
};

const nameOf = (seat: LiveRow['seats'][number] | undefined) =>
  seat?.username ? `@${seat.username}` : (seat?.botName ?? null);

/**
 * The card's seats: each side by its short name, its first seat's debater
 * named; an unsided format lists every speaker's seat. The floor's lead seat
 * (its side, for a sided format) is the one speaking.
 */
const seatsOf = (row: LiveRow, lead: SeatRef | null): readonly CardSeat[] => {
  if (row.rules.sides.length > 0)
    return row.rules.sides.map((side) => ({
      label: sideShortName(row.rules.sides, side.key),
      name: nameOf(
        row.seats.find((seat) => sideOfSeat(seat.seat) === side.key),
      ),
      speaking: lead !== null && sideOfSeat(lead) === side.key,
    }));
  return everySeatOf(row.rules)
    .filter(isDebatingSeat)
    .map((declared) => ({
      label: seatName(row.rules, declared),
      name: nameOf(row.seats.find((seat) => sameSeat(seat.seat, declared))),
      speaking: lead !== null && sameSeat(lead, declared),
    }));
};

const progressOf = (row: LiveRow, onFloor: boolean): LiveCard['progress'] => {
  const reached = row.rules.segments.findIndex(
    (segment) => segment.key === row.segments[0]?.key,
  );
  return row.rules.segments.map((_, index) => {
    if (index < reached) return 'done';
    if (index > reached) return 'upcoming';
    return onFloor ? 'current' : 'done';
  });
};

/** The listing's card, by the same stage rule the player follows. */
export function liveCardOf(row: LiveRow): LiveCard {
  const stage = releasedStage({
    round: row,
    outcomeReleased: false,
    segments: row.segments,
    horizonMs: row.horizonMs,
    stopped: false,
  });
  const floor = stage.kind === 'floor' ? stage : null;
  return {
    id: row.id,
    href: liveHref(row.id),
    title: row.title,
    ranked: row.competitionType === 'ranked',
    ladder: row.ladder,
    mode: modeLabel(row.competitionType),
    resolution: row.resolution,
    seats: seatsOf(row, floor?.lead ?? null),
    phaseName: floor?.label ?? 'Between speeches',
    secondsLeft: floor ? Math.floor(floor.remainingMs / 1000) : null,
    progress: progressOf(row, floor !== null),
  };
}
