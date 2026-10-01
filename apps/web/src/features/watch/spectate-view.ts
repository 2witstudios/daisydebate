import {
  debaterOn,
  type Side,
  type SpeechPhase,
  type WatchDebate,
} from './debate';
import {
  clockLabel,
  durationLabel,
  modeLabel,
  rulesLabel,
  sideLabel,
  visibilityLabel,
} from './labels';
import { replayHref } from './routes';
import { spokenTurns, totalSeconds, type Turn } from './schedule';
import type { SpectatorSocial } from './social';
import type { SpectateQuery } from './spectate-query';

type SeatView = {
  readonly side: Side;
  readonly label: string;
  readonly handle: string;
  readonly rating: number;
  readonly standing: string;
  /** What they are doing now; null once the debate has ended. */
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

/** The status strip above the seats when the debate is over. */
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
    /** Null once ended: nobody is watching a finished debate. */
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
    /** Chat and reactions close when the debate ends. */
    readonly open: boolean;
  };
  /** The audience's connection; the realtime layer owns the real value. */
  readonly connection: 'connected' | 'reconnecting';
  readonly query: SpectateQuery;
  /** What the open report dialog is about, resolved for display. */
  readonly reportTarget: string | null;
  /** True once a report was sent; nothing can send one yet. */
  readonly reportSent: boolean;
  readonly about: {
    readonly rules: string;
    readonly season: string;
    readonly delaySeconds: number;
  };
};

type Input = {
  readonly debate: WatchDebate;
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
  readonly reportSent?: boolean;
};

const STANDINGS = {
  established: 'Established',
  provisional: 'Provisional',
} as const;

/** A speech still being spoken reads as its first words and an ellipsis. */
const partial = (text: string): string =>
  `${text.split(' ').slice(0, 8).join(' ')}…`;

function seatView(
  debate: WatchDebate,
  side: Side,
  speaking: Side | null,
): SeatView {
  const debater = debaterOn(debate, side);
  return {
    side,
    label: sideLabel(side),
    handle: debater.handle,
    rating: debater.rating,
    standing: STANDINGS[debater.standing],
    activity:
      speaking === null ? null : speaking === side ? 'Speaking' : 'Listening',
  };
}

function bannerFor(debate: WatchDebate): Banner | null {
  if (debate.state.status !== 'ended') return null;
  const { ballots } = debate.state;
  const href = replayHref(debate.id);
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
      : [`@${debaterOn(debate, side).handle} ${change.from} to ${change.to}`];
  });
  return {
    kind: 'result',
    headline: `${sideLabel(ballots.winner)} wins, ${ballots.judgesFor} to ${ballots.judgesAgainst}`,
    detail: `${ratings.length > 0 ? `${ratings.join(', ')}. ` : 'Casual debates are not rated. '}Judge reasons are in the recording.`,
    replayHref: href,
  };
}

type Ctx = Input & {
  readonly live: boolean;
  readonly turnIndex: number;
  readonly phaseIndex: number;
};

function clockFor({ debate, phases, context, live, phaseIndex }: Ctx): Clock {
  const { state } = debate;
  const phase = phases[phaseIndex];
  if (state.status !== 'live' || !phase)
    return { kind: 'final', totalLabel: clockLabel(totalSeconds(phases)) };
  return {
    kind: 'running',
    phaseName: phase.name,
    secondsLeft: state.speechSecondsLeft,
    speaker: `@${debaterOn(debate, phase.side).handle}`,
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

function captionFor({ debate, phases, live, phaseIndex }: Ctx): string {
  const next = phases[phaseIndex + 1];
  if (live)
    return next
      ? `Next: ${next.name}, ${sideLabel(next.side)} · ${durationLabel(next.seconds)}`
      : 'Last speech in progress';
  return debate.state.status === 'ended' &&
    debate.state.ballots.state === 'pending'
    ? 'Ballots are being collected'
    : 'Debate complete';
}

function speechRows(ctx: Ctx): readonly SpeechRow[] {
  const { debate, phases, turns, live, turnIndex } = ctx;
  const spoken = live ? spokenTurns(turns, turnIndex) : turns;
  return spoken.map((turn, index) => {
    const phase = phases[turn.phaseIndex];
    const side = phase?.side ?? 'aff';
    const speakingNow = live && index === turnIndex;
    return {
      stamp: durationLabel(turn.startSeconds),
      handle: `@${debaterOn(debate, side).handle}`,
      seat: `${sideLabel(side)}, ${phase?.abbreviation ?? ''}`,
      text: speakingNow ? partial(turn.text) : turn.text,
      speakingNow,
    };
  });
}

function reportTargetOf({ query, social }: Input): string | null {
  const subject = query.report;
  if (subject === null) return null;
  if (subject.kind === 'debate') return 'the debate';
  const message = social.messages.find((m) => m.id === subject.id);
  return `a message from @${message?.handle ?? 'a spectator'}`;
}

/**
 * The live view of a debate a viewer may watch, live or just ended. Pure: the
 * caller hands in the debate, its timetable and the audience's chat.
 */
export function buildSpectateView(input: Input): SpectateView {
  const { debate, query, phases, turns, social, context } = input;
  const { state } = debate;
  const live = state.status === 'live';
  const turnIndex = live ? state.turnIndex : turns.length - 1;
  const phaseIndex = turns[turnIndex]?.phaseIndex ?? 0;
  const ctx: Ctx = { ...input, live, turnIndex, phaseIndex };
  const speaking = live ? (phases[phaseIndex]?.side ?? null) : null;
  return {
    id: debate.id,
    title: debate.title,
    live,
    badges: {
      mode: modeLabel(debate.mode),
      rules: rulesLabel(debate),
      visibility: visibilityLabel(debate.visibility),
      watching: state.status === 'live' ? state.watching : null,
    },
    subtitle: `${context.resolution} ${rulesLabel(debate)}, season ${context.season}.`,
    seats: {
      aff: seatView(debate, 'aff', speaking),
      neg: seatView(debate, 'neg', speaking),
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
    banner: bannerFor(debate),
    social: { ...social, open: live },
    connection: input.connection ?? 'connected',
    query,
    reportTarget: reportTargetOf(input),
    reportSent: input.reportSent ?? false,
    about: {
      rules: rulesLabel(debate),
      season: context.season,
      delaySeconds: context.delaySeconds,
    },
  };
}
