import { debaterOn, type Debater, type Side, type SpeechPhase } from './round';
import type { LiveRound } from './live-list';
import { modeLabel, rulesLabel, sideLabel } from './labels';
import { liveHref } from './routes';
import type { Turn } from './schedule';

type CardSeat = {
  readonly label: string;
  readonly handle: string;
  readonly rating: number;
  readonly standing: string;
  readonly speaking: boolean;
};

/** One live Round as a hub card shows it. */
export type LiveCard = {
  readonly id: string;
  readonly href: string;
  readonly title: string;
  readonly ranked: boolean;
  readonly mode: string;
  readonly rules: string;
  /** Casual only: ranked always runs the standard rules. */
  readonly customRules: boolean;
  readonly watching: number;
  readonly aff: CardSeat;
  readonly neg: CardSeat;
  readonly phaseName: string;
  readonly speaker: string;
  readonly secondsLeft: number;
  /** One step per speech: finished, in progress or still to come. */
  readonly progress: readonly ('done' | 'current' | 'upcoming')[];
  /** The first words of the speech in progress. */
  readonly excerpt: string;
};

const standing = (debater: Debater): string =>
  debater.standing === 'established' ? 'est.' : 'prov.';

const seatOf = (round: LiveRound, side: Side, speaking: Side): CardSeat => {
  const debater = debaterOn(round, side);
  return {
    label: sideLabel(side),
    handle: debater.handle,
    rating: debater.rating,
    standing: standing(debater),
    speaking: side === speaking,
  };
};

/** The hub card for a live Round, given its timetable. */
export function liveCardOf(
  round: LiveRound,
  phases: readonly SpeechPhase[],
  turns: readonly Turn[],
): LiveCard {
  const turn = turns[round.state.turnIndex];
  const phaseIndex = turn?.phaseIndex ?? 0;
  const phase = phases[phaseIndex];
  const speaking: Side = phase?.side ?? 'aff';
  return {
    id: round.id,
    href: liveHref(round.id),
    title: round.title,
    ranked: round.mode === 'ranked',
    mode: modeLabel(round.mode),
    rules: rulesLabel(round),
    customRules: round.customRules,
    watching: round.state.watching,
    aff: seatOf(round, 'aff', speaking),
    neg: seatOf(round, 'neg', speaking),
    phaseName: phase?.name ?? '',
    speaker: debaterOn(round, speaking).handle,
    secondsLeft: round.state.speechSecondsLeft,
    progress: phases.map((_, index) =>
      index < phaseIndex
        ? 'done'
        : index === phaseIndex
          ? 'current'
          : 'upcoming',
    ),
    excerpt: `${(turn?.text ?? '').split(' ').slice(0, 14).join(' ')}…`,
  };
}
