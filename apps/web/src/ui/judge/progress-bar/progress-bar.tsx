import {
  progressFillClass,
  progressTrackClass,
  type ProgressTone,
} from './progress-bar-class';

export type ProgressBarProps = {
  /** 0 to 100. */
  readonly percent: number;
  readonly tone: ProgressTone;
  /** What the bar measures, for assistive technology. */
  readonly label: string;
};

export function ProgressBar({ percent, tone, label }: ProgressBarProps) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className={progressTrackClass}
    >
      <div className={progressFillClass(percent, tone)} />
    </div>
  );
}
