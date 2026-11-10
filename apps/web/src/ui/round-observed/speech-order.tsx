import type {
  ObservedSpeech,
  ObservedSpeechState,
} from '../../features/round-runtime/observed-round';
import { formatCountdown } from '../../lib/clock-display';
import { cn } from '../cn';

const stateLabel: Readonly<Record<ObservedSpeechState, string | null>> = {
  done: 'Done',
  now: 'Now',
  next: 'Next',
  upcoming: null,
};

const sideInk = {
  affirmative: 'text-hue-sky',
  negative: 'text-hue-clay',
} as const;

/**
 * Every speech and cross-examination in order, by code and full name, with
 * its length and whether it is done, on now or next. The one on now is the
 * list's current step.
 */
export function ObservedSpeechOrder({
  speeches,
  labelledBy,
}: {
  readonly speeches: readonly ObservedSpeech[];
  /** The id of the heading that names this list. */
  readonly labelledBy: string;
}) {
  return (
    <ol aria-labelledby={labelledBy} className="flex flex-col gap-1 text-sm">
      {speeches.map((speech, index) => {
        const state = stateLabel[speech.state];
        return (
          <li
            key={`${index}-${speech.key}`}
            aria-current={speech.state === 'now' ? 'step' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-sm border px-3 py-2',
              speech.state === 'next'
                ? 'border-border-strong'
                : 'border-transparent',
              speech.state === 'now' && 'bg-accent text-accent-ink',
              speech.state === 'done' && 'text-ink-muted',
            )}
          >
            <span
              className={cn(
                'w-12 shrink-0 font-bold',
                speech.state === 'upcoming' || speech.state === 'next'
                  ? sideInk[speech.side]
                  : undefined,
              )}
            >
              {speech.key}
            </span>
            <span className="min-w-0 flex-1 wrap-anywhere">{speech.label}</span>
            <span className="shrink-0 tabular-nums">
              {formatCountdown(speech.durationMs)}
            </span>
            <span className="w-10 shrink-0 text-right text-xs font-strong">
              {state}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
