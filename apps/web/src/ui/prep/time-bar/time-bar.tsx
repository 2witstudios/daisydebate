import type { Budget } from '../../../features/prep/reading-time';
import { PrepIcon } from '../prep-icon/prep-icon';
import { timeBarClass } from './time-bar-class';

export type TimeBarProps = {
  readonly label: string;
  /** Read time, m:ss. */
  readonly clock: string;
  readonly budget: Budget;
  /** Shown when over: the gap and the words to cut. */
  readonly overText?: string;
  /** Shown when within. */
  readonly spareText?: string;
};

/** A reading time against the speech limit, with the limit left as a placeholder. */
export function TimeBar({
  label,
  clock,
  budget,
  overText,
  spareText,
}: TimeBarProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-strong">{label}</span>
        <span
          className={budget.over ? 'font-strong text-live' : 'text-ink-muted'}
        >
          {`${clock} of [speech time]`}
        </span>
      </div>
      <progress
        max={100}
        value={budget.percent}
        aria-label={`${label}: reading time against the speech limit`}
        className={timeBarClass(budget.over)}
      />
      {budget.over && overText !== undefined ? (
        <p className="flex items-start gap-1 text-sm font-strong text-live">
          <PrepIcon name="warning" size={16} className="mt-1" />
          {overText}
        </p>
      ) : null}
      {!budget.over && spareText !== undefined ? (
        <p className="text-xs text-ink-faint">{spareText}</p>
      ) : null}
    </div>
  );
}
