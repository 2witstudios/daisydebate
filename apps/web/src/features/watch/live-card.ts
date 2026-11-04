import type { LiveBroadcastPage } from '@daisy/db';
import { releasedStage } from '@daisy/debate-engine';
import { modeLabel } from './labels';
import { liveHref } from './routes';

type LiveRow = LiveBroadcastPage['rows'][number];

type CardSeat = {
  readonly label: 'Aff' | 'Neg';
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
  readonly mode: string;
  readonly resolution: string | null;
  readonly aff: CardSeat;
  readonly neg: CardSeat;
  readonly phaseName: string;
  /** The clock as the released video shows it; null off the floor. */
  readonly secondsLeft: number | null;
  /** One step per speech: finished, in progress or still to come. */
  readonly progress: readonly ('done' | 'current' | 'upcoming')[];
};

const seatOf = (
  row: LiveRow,
  side: 'affirmative' | 'negative',
  speaking: string | null,
): CardSeat => {
  const seat = row.seats.find((candidate) => candidate.side === side);
  return {
    label: side === 'affirmative' ? 'Aff' : 'Neg',
    name: seat?.username ? `@${seat.username}` : (seat?.botName ?? null),
    speaking: speaking === side,
  };
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
    title: row.title ?? 'Debate',
    ranked: row.competitionType === 'ranked',
    mode: modeLabel(row.competitionType),
    resolution: row.resolution,
    aff: seatOf(row, 'affirmative', floor?.side ?? null),
    neg: seatOf(row, 'negative', floor?.side ?? null),
    phaseName: floor?.label ?? 'Between speeches',
    secondsLeft: floor ? Math.floor(floor.remainingMs / 1000) : null,
    progress: progressOf(row, floor !== null),
  };
}
