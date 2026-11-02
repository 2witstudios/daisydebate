import {
  debaterOn,
  type Side,
  type SpeechPhase,
  type WatchRound,
} from './round';
import {
  clockLabel,
  durationLabel,
  modeLabel,
  rulesLabel,
  sideLabel,
  visibilityLabel,
} from './labels';
import { initialsOf } from '../../lib/initials';
import { replayHref } from './routes';
import { spokenTurns, totalSeconds, type Turn } from './schedule';
import type { SpectatorSocial } from './social';
import type { SpectateQuery } from './spectate-query';

type SeatView = {
  readonly side: Side;
  readonly label: string;
  readonly handle: string;
  /** Up to two letters from the handle, shown on the video tile. */
  readonly initials: string;
  readonly rating: number;
  readonly standing: string;
  /** What they are doing now; null once the Round has ended. */
  readonly activity: 'Speaking' | 'Listening' | null;
};

type TimelineStep = {
  readonly abbreviation: string;
  /** Accessible name: the speech and its length. */
  readonly label: string;
  readonly state: 'done' | 'current' | 'upcoming';
};

type SpeechRow = {
  readonly stamp: string;
  readonly handle: string;
  /** "Aff, S1". */
  readonly seat: string;
  readonly text: string;
  readonly speakingNow: boolean;
};

/** The status strip above the seats when the Round is over. */
type Banner =
  | {
      readonly kind: 'pending';
      readonly received: number;
      readonly of: number;
      readonly replayHref: string;
    }
  | {
      readonly kind: 'result';
      readonly headline: string;
      readonly detail: string;
      readonly replayHref: string;
    };

type Clock =
  | {
      readonly kind: 'running';
      readonly phaseName: string;
      readonly secondsLeft: number;
      readonly speaker: string;
      readonly delaySeconds: number;
    }
  | { readonly kind: 'final'; readonly totalLabel: string };

export type SpectateView = {
  readonly id: string;
  readonly title: string;
  readonly live: boolean;
  readonly badges: {
    readonly mode: string;
    readonly rules: string;
    readonly visibility: string;
    /** Null once ended: nobody is watching a finished Round. */
    readonly watching: number | null;
  };
  readonly subtitle: string;
  readonly seats: { readonly aff: SeatView; readonly neg: SeatView };
  readonly clock: Clock;
  readonly timeline: {
    readonly steps: readonly TimelineStep[];
    readonly caption: string;
  };
  readonly speeches: readonly SpeechRow[];
  readonly banner: Banner | null;
  readonly social: SpectatorSocial & {
    /** Chat and reactions close when the Round ends. */
    readonly open: boolean;
  };
  /** The audience's connection; the realtime layer owns the real value. */
  readonly connection: 'connected' | 'reconnecting';
  readonly query: SpectateQuery;
  /** How far the audience runs behind the debaters. */
  readonly delaySeconds: number;
};

type Input = {
  readonly round: WatchRound;
  readonly query: SpectateQuery;
  readonly phases: readonly SpeechPhase[];
  readonly turns: readonly Turn[];
  readonly social: SpectatorSocial;
  readonly context: {
    readonly resolution: string;
    readonly season: string;
    readonly delaySeconds: number;
  };
  readonly connection?: SpectateView['connection'];
};

const STANDINGS = {
  established: 'Established',
  provisional: 'Provisional',
} as const;

/** A speech still being spoken reads as its first words and an ellipsis. */
const partial = (text: string): string =>
  `${text.split(' ').slice(0, 8).join(' ')}…`;

function seatView(
  round: WatchRound,
  side: Side,
  speaking: Side | null,
): SeatView {
  const debater = debaterOn(round, side);
  return {
    side,
    label: sideLabel(side),
    handle: debater.handle,
    initials: initialsOf(debater.handle),
    rating: debater.rating,
    standing: STANDINGS[debater.standing],
    activity:
      speaking === null ? null : speaking === side ? 'Speaking' : 'Listening',
  };
}

function bannerFor(round: WatchRound): Banner | null {
  if (round.state.status !== 'ended') return null;
  const { ballots } = round.state;
  const href = replayHref(round.id);
  if (ballots.state === 'pending')
    return {
      kind: 'pending',
      received: ballots.received,
      of: ballots.of,
      replayHref: href,
    };
  const ratings = (['aff', 'neg'] as const).flatMap((side) => {
    const change = ballots[side];
    return change === null
      ? []
      : [`@${debaterOn(round, side).handle} ${change.from} to ${change.to}`];
  });
  return {
    kind: 'result',
    headline: `${sideLabel(ballots.winner)} wins, ${ballots.judgesFor} to ${ballots.judgesAgainst}`,
    detail: `${ratings.length > 0 ? `${ratings.join(', ')}. ` : 'Casual debates are not ranked. '}Judge reasons are in the recording.`,
    replayHref: href,
  };
}

type Ctx = Input & {
  readonly live: boolean;
  readonly turnIndex: number;
  readonly phaseIndex: number;
};

function clockFor({ round, phases, context, live, phaseIndex }: Ctx): Clock {
  const { state } = round;
  const phase = phases[phaseIndex];
  if (state.status !== 'live' || !phase)
    return { kind: 'final', totalLabel: clockLabel(totalSeconds(phases)) };
  return {
    kind: 'running',
    phaseName: phase.name,
    secondsLeft: state.speechSecondsLeft,
    speaker: `@${debaterOn(round, phase.side).handle}`,
    delaySeconds: live ? context.delaySeconds : 0,
  };
}

const stepState = (
  live: boolean,
  index: number,
  current: number,
): TimelineStep['state'] =>
  !live || index < current
    ? 'done'
    : index === current
      ? 'current'
      : 'upcoming';

function captionFor({ round, phases, live, phaseIndex }: Ctx): string {
  const next = phases[phaseIndex + 1];
  if (live)
    return next
      ? `Next: ${next.name}, ${sideLabel(next.side)} · ${durationLabel(next.seconds)}`
      : 'Last speech in progress';
  return round.state.status === 'ended' &&
    round.state.ballots.state === 'pending'
    ? 'Ballots are being collected'
    : 'Debate complete';
}

function speechRows(ctx: Ctx): readonly SpeechRow[] {
  const { round, phases, turns, live, turnIndex } = ctx;
  const spoken = live ? spokenTurns(turns, turnIndex) : turns;
  return spoken.map((turn, index) => {
    const phase = phases[turn.phaseIndex];
    const side = phase?.side ?? 'aff';
    const speakingNow = live && index === turnIndex;
    return {
      stamp: durationLabel(turn.startSeconds),
      handle: `@${debaterOn(round, side).handle}`,
      seat: `${sideLabel(side)}, ${phase?.abbreviation ?? ''}`,
      text: speakingNow ? partial(turn.text) : turn.text,
      speakingNow,
    };
  });
}

/**
 * The live view of a Round a viewer may watch, live or just ended. Pure: the
 * caller hands in the Round, its timetable and the audience's chat.
 */
export function buildSpectateView(input: Input): SpectateView {
  const { round, query, phases, turns, social, context } = input;
  const { state } = round;
  const live = state.status === 'live';
  const turnIndex = live ? state.turnIndex : turns.length - 1;
  const phaseIndex = turns[turnIndex]?.phaseIndex ?? 0;
  const ctx: Ctx = { ...input, live, turnIndex, phaseIndex };
  const speaking = live ? (phases[phaseIndex]?.side ?? null) : null;
  return {
    id: round.id,
    title: round.title,
    live,
    badges: {
      mode: modeLabel(round.mode),
      rules: rulesLabel(round),
      visibility: visibilityLabel(round.visibility),
      watching: state.status === 'live' ? state.watching : null,
    },
    subtitle: `${context.resolution} ${rulesLabel(round)}, season ${context.season}.`,
    seats: {
      aff: seatView(round, 'aff', speaking),
      neg: seatView(round, 'neg', speaking),
    },
    clock: clockFor(ctx),
    timeline: {
      steps: phases.map((p, index) => ({
        abbreviation: p.abbreviation,
        label: `${p.name}, ${durationLabel(p.seconds)}`,
        state: stepState(live, index, phaseIndex),
      })),
      caption: captionFor(ctx),
    },
    speeches: speechRows(ctx),
    banner: bannerFor(round),
    social: { ...social, open: live },
    connection: input.connection ?? 'connected',
    query,
    delaySeconds: context.delaySeconds,
  };
}
