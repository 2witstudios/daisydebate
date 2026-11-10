import {
  clockMilestone,
  clockUrgency,
  type ClockUrgency,
} from '../../features/debate-room/clock';
import { formatCountdown } from '../../lib/clock-display';
import { cn } from '../cn';

const urgencyInk: Readonly<Record<ClockUrgency, string>> = {
  normal: 'text-ink',
  low: 'text-gold',
  critical: 'text-live',
  over: 'text-live',
};

/**
 * One running clock, as every seat in a Round sees it: the label, the time
 * left coloured by urgency, and the milestones (a minute left, time's up)
 * announced politely. The timer itself is not live, so a screen reader is
 * not read every second.
 */
export function RoundClock({
  label,
  remainingMs,
  className,
  size = 'large',
}: {
  readonly label: string;
  readonly remainingMs: number;
  readonly className?: string;
  readonly size?: 'large' | 'medium';
}) {
  return (
    <>
      <div
        role="timer"
        aria-label={`${label} ${formatCountdown(remainingMs)}`}
        className={className}
      >
        <span className="text-xs font-strong tracking-wider text-ink-muted uppercase">
          {label}
        </span>
        <span
          className={cn(
            'font-display tabular-nums',
            size === 'large' ? 'text-3xl' : 'text-2xl',
            urgencyInk[clockUrgency(remainingMs)],
          )}
        >
          {formatCountdown(remainingMs)}
        </span>
      </div>
      <p aria-live="polite" className="sr-only">
        {clockMilestone(remainingMs)}
      </p>
    </>
  );
}
