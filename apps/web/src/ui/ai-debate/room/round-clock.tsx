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

/** The clock for this moment, large and centred, with what it counts down to. */
export function RoundClock({
  state,
  personSide,
}: {
  readonly state: AiDebateState;
  readonly personSide: AiDebateSide;
}) {
  const reading =
    state.phase === 'aborted' ? null : readingOf(state, personSide);
  if (!reading) return null;
  return (
    <p role="timer" className="flex flex-col items-center">
      <span className="text-xs font-strong tracking-wider text-ink-muted uppercase">
        {reading.caption}
      </span>
      <span
        className={cn(
          'font-display text-display-sm leading-display font-strong tabular-nums transition-colors',
          reading.tone === 'urgent'
            ? 'text-live'
            : reading.tone === 'warm'
              ? 'text-gold'
              : 'text-ink',
        )}
      >
        {reading.time}
      </span>
    </p>
  );
}
