import type { DebateSide } from '@daisy/protocol';
import { cn } from '../../cn';
import {
  segmentAt,
  type AiDebateView,
  type UiSegment,
  type UiState,
} from '../../../features/ai-debate/context';

const minutes = (ms: number) => {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

const seconds = (ms: number) => String(Math.max(0, Math.ceil(ms / 1000)));

/** Who a segment belongs to: the speaker, or for cross-examination the asker. */
const ownerOf = (segment: UiSegment, personSide: DebateSide) =>
  segment.side === personSide ? 'person' : 'ai';

/** What the next segment is, said as "until …". */
function untilCaption(segment: UiSegment, personSide: DebateSide) {
  const yours = ownerOf(segment, personSide) === 'person';
  if (segment.kind === 'cross-examination')
    return yours ? 'until you ask' : 'until your opponent asks';
  return yours ? 'until you speak' : 'until your opponent speaks';
}

function liveCaption(segment: UiSegment, personSide: DebateSide) {
  if (segment.kind === 'cross-examination') return 'left in cross-examination';
  return ownerOf(segment, personSide) === 'person'
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
  state: UiState,
  view: AiDebateView,
  personSide: DebateSide,
): Reading | null {
  const segment =
    'segmentIndex' in state ? segmentAt(view, state.segmentIndex) : null;
  if (state.phase === 'countdown')
    return {
      time: seconds(state.remainingMs),
      caption: segment ? untilCaption(segment, personSide) : 'until it starts',
      tone: 'calm',
    };
  if (state.phase === 'prep')
    return state.remainingMs <= view.rules.countdownMs
      ? {
          time: seconds(state.remainingMs),
          caption: 'until your speech starts',
          tone: 'warm',
        }
      : {
          time: minutes(state.remainingMs),
          caption: 'prep left',
          tone: 'calm',
        };
  if (state.phase !== 'live') return null;
  return {
    time: minutes(state.remainingMs),
    caption: segment
      ? liveCaption(segment, personSide)
      : 'left in this segment',
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
  view,
  personSide,
}: {
  readonly state: UiState;
  readonly view: AiDebateView | null;
  readonly personSide: DebateSide;
}) {
  const reading =
    state.phase === 'aborted' || view === null
      ? null
      : readingOf(state, view, personSide);
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
