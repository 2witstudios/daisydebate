'use client';

import { cn } from '../../cn';
import { Icon } from '../../components/icon/icon';
import { barWidthClass, secondsLeft } from './seconds';
import { useElapsedSeconds } from './use-elapsed-seconds';

/**
 * "Respond within N seconds" with a draining bar. It only displays the time:
 * the step moves on through the page's own advance, so with no script it
 * reads the full time and the page still moves on.
 */
export function Countdown({ seconds }: { readonly seconds: number }) {
  const left = secondsLeft(seconds, useElapsedSeconds());
  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-center gap-2 text-base font-strong">
        <Icon name="clock" size={18} className="text-accent" />
        <span>
          Respond within <span className="tabular-nums">{left}</span> seconds
        </span>
      </p>
      <div
        className="h-1 overflow-hidden rounded-full bg-surface-overlay"
        aria-hidden="true"
      >
        <div
          className={cn(
            'h-full rounded-full bg-accent',
            barWidthClass(left, seconds),
          )}
        />
      </div>
    </div>
  );
}
