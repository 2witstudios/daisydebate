import { debaterOn, type Debater, type Side, type SpeechPhase } from './debate';
import type { LiveDebate } from './live-list';
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

/** One live debate as a hub card shows it. */
export type LiveCard = {
  readonly id: string;
  readonly href: string;
  readonly title: string;
  readonly ranked: boolean;
  readonly mode: string;
  readonly rules: string;
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

const seatOf = (debate: LiveDebate, side: Side, speaking: Side): CardSeat => {
  const debater = debaterOn(debate, side);
  return {
    label: sideLabel(side),
    handle: debater.handle,
    rating: debater.rating,
    standing: standing(debater),
    speaking: side === speaking,
  };
};

/** The hub card for a live debate, given its timetable. */
export function liveCardOf(
  debate: LiveDebate,
  phases: readonly SpeechPhase[],
  turns: readonly Turn[],
): LiveCard {
  const turn = turns[debate.state.turnIndex];
  const phaseIndex = turn?.phaseIndex ?? 0;
  const phase = phases[phaseIndex];
  const speaking: Side = phase?.side ?? 'aff';
  return {
    id: debate.id,
    href: liveHref(debate.id),
    title: debate.title,
    ranked: debate.mode === 'ranked',
    mode: modeLabel(debate.mode),
    rules: rulesLabel(debate),
    watching: debate.state.watching,
    aff: seatOf(debate, 'aff', speaking),
    neg: seatOf(debate, 'neg', speaking),
    phaseName: phase?.name ?? '',
    speaker: debaterOn(debate, speaking).handle,
    secondsLeft: debate.state.speechSecondsLeft,
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
