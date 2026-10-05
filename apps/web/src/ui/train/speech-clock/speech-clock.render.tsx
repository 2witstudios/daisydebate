import type { ReactNode } from 'react';
import { Modal } from '../modal/modal';
import { Meter } from '../meter/meter';
import { buttonClass } from '../../components/button/button-class';
import { cn } from '../../cn';

export type SpeechClockViewProps = {
  readonly display: string;
  readonly lengthLabel: string;
  readonly percent: number;
  readonly paused: boolean;
  readonly timeUp: boolean;
  /** False until the page has hydrated: the clock cannot run without script. */
  readonly live: boolean;
  readonly actions: ReactNode;
  readonly onPause: () => void;
  readonly onResume: () => void;
  /** Where End debate goes from the pause dialog. */
  readonly endHref: ReactNode;
};

/** The clock's markup, pure so its states and callbacks are testable. */
export function renderSpeechClock({
  display,
  lengthLabel,
  percent,
  paused,
  timeUp,
  live,
  actions,
  onPause,
  onResume,
  endHref,
}: SpeechClockViewProps) {
  return (
    <>
      <div className="flex items-baseline gap-3">
        <span
          role="timer"
          aria-label="Time left in this speech"
          className="font-display text-display-sm leading-display font-bold text-ink tabular-nums max-compact:text-3xl"
        >
          {display}
        </span>
        <span className="text-base text-ink-muted">{`of ${lengthLabel}`}</span>
      </div>
      <Meter value={percent} label="Speech time used" />
      <p aria-live="polite" className="min-h-6 text-base font-strong text-live">
        {timeUp ? 'Time is up' : ''}
      </p>
      <div className="flex flex-wrap gap-3">
        {actions}
        <button
          type="button"
          disabled={!live}
          onClick={onPause}
          className={cn(buttonClass('secondary'))}
        >
          Pause
        </button>
      </div>
      {paused ? (
        <Modal
          label="Paused"
          title="Paused"
          actions={
            <>
              <button
                type="button"
                onClick={onResume}
                className={cn(buttonClass('primary'))}
              >
                Resume
              </button>
              {endHref}
            </>
          }
        />
      ) : null}
    </>
  );
}
