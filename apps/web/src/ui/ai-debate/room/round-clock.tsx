import {
  aiDebateCountdownMs,
  aiDebateTurns,
  turnRoles,
  type AiDebateSide,
  type AiDebateState,
  type AiDebateTurn,
} from '@daisy/debate-engine';
import { cn } from '../../cn';

const minutes = (ms: number) => {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

const seconds = (ms: number) => String(Math.max(0, Math.ceil(ms / 1000)));

/** Who a turn belongs to: the speaker, or for cross-examination the asker. */
const ownerOf = (turn: AiDebateTurn, personSide: AiDebateSide) =>
  turnRoles(turn, personSide).speaker;

/** What the next turn is, said as "until …". */
function untilCaption(turn: AiDebateTurn, personSide: AiDebateSide) {
  const yours = ownerOf(turn, personSide) === 'person';
  if (turn.kind === 'cross-examination')
    return yours ? 'until you ask' : 'until your opponent asks';
  return yours ? 'until you speak' : 'until your opponent speaks';
}

function liveCaption(turn: AiDebateTurn, personSide: AiDebateSide) {
  if (turn.kind === 'cross-examination') return 'left in cross-examination';
  return ownerOf(turn, personSide) === 'person'
    ? 'left in your speech'
    : 'left in their speech';
}

type Reading = {
  readonly time: string;
  readonly caption: string;
  readonly tone: 'calm' | 'warm' | 'urgent';
};

/** The clock's reading for a state, or null when no clock runs. */
function readingOf(
  state: AiDebateState,
  personSide: AiDebateSide,
): Reading | null {
  if (state.phase === 'countdown')
    return {
      time: seconds(state.remainingMs),
      caption: untilCaption(aiDebateTurns[state.turnIndex]!, personSide),
      tone: 'calm',
    };
  if (state.phase === 'prep')
    return state.prepLeftMs <= aiDebateCountdownMs
      ? {
          time: seconds(state.prepLeftMs),
          caption: 'until your speech starts',
          tone: 'warm',
        }
      : { time: minutes(state.prepLeftMs), caption: 'prep left', tone: 'calm' };
  if (state.phase !== 'live') return null;
  return {
    time: minutes(state.remainingMs),
    caption: liveCaption(aiDebateTurns[state.turnIndex]!, personSide),
    tone:
      state.remainingMs <= 30_000
        ? 'urgent'
        : state.remainingMs <= 60_000
          ? 'warm'
          : 'calm',
  };
}

/** How much of each turn has passed, 0..1. */
function progressOf(state: AiDebateState, turn: AiDebateTurn) {
  if (state.phase === 'ended') return 1;
  if (!('turnIndex' in state)) return 0;
  if (turn.index < state.turnIndex) return 1;
  if (turn.index > state.turnIndex || state.phase !== 'live') return 0;
  const length = state.endsAt - state.startedAt;
  return Math.min(1, 1 - state.remainingMs / length);
}

const fill = {
  person: 'bg-accent',
  ai: 'bg-yolk',
} as const;

// The track is the owner's colour, faint, so the whole round reads ahead
// of time; the passed share fills in full.
const bar = {
  person:
    '[&::-webkit-progress-bar]:bg-accent-soft [&::-webkit-progress-value]:bg-accent [&::-moz-progress-bar]:bg-accent bg-accent-soft',
  ai: '[&::-webkit-progress-bar]:bg-gold-soft [&::-webkit-progress-value]:bg-yolk [&::-moz-progress-bar]:bg-yolk bg-gold-soft',
} as const;

/** Each turn's share of the bar: as wide as it is long, in minutes. */
const width: Record<number, string> = {
  3: 'grow-3',
  5: 'grow-5',
  6: 'grow-6',
};

/**
 * The round at a glance: the clock for this moment, and the seven turns as
 * one bar, each as wide as it is long, filling as the round goes on.
 */
export function RoundClock({
  state,
  personSide,
  opponent,
}: {
  readonly state: AiDebateState;
  readonly personSide: AiDebateSide;
  /** The opponent's name, for the legend. */
  readonly opponent: string;
}) {
  if (state.phase === 'aborted') return null;
  const reading = readingOf(state, personSide);
  const current = 'turnIndex' in state ? state.turnIndex : null;
  return (
    <div className="flex flex-col gap-3">
      {reading ? (
        <p role="timer" className="flex items-baseline gap-2">
          <span
            className={cn(
              'font-display text-display-sm font-strong tabular-nums transition-colors',
              reading.tone === 'urgent'
                ? 'text-live'
                : reading.tone === 'warm'
                  ? 'text-gold'
                  : 'text-ink',
            )}
          >
            {reading.time}
          </span>
          <span className="text-ink-muted">{reading.caption}</span>
        </p>
      ) : null}
      <ol aria-label="Round timeline" className="flex gap-px">
        {aiDebateTurns.map((turn) => {
          const owner = ownerOf(turn, personSide);
          const here = turn.index === current;
          return (
            <li
              key={turn.index}
              className={cn(
                'flex min-w-0 basis-0 flex-col gap-1',
                width[turn.durationMs / 60_000] ?? 'grow',
              )}
              aria-current={here ? 'step' : undefined}
              title={`${turn.label} · ${minutes(turn.durationMs)} · ${owner === 'person' ? 'You' : opponent}`}
            >
              <progress
                max={100}
                value={Math.round(progressOf(state, turn) * 100)}
                aria-label={`${turn.label}: time passed`}
                className={cn(
                  'h-2 w-full appearance-none overflow-hidden rounded-round',
                  bar[owner],
                )}
              />
              <span
                className={cn(
                  'truncate text-xs tabular-nums',
                  here ? 'font-strong text-ink' : 'text-ink-muted',
                )}
              >
                {turn.name}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="flex gap-4 text-xs text-ink-muted">
        <span className="flex items-center gap-1">
          <span className={cn('size-2 rounded-full', fill.person)} /> You
        </span>
        <span className="flex items-center gap-1">
          <span className={cn('size-2 rounded-full', fill.ai)} /> {opponent}
        </span>
      </p>
    </div>
  );
}
