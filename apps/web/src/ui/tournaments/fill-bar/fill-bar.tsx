import { fillBarClass, fillTrackClass } from './fill-bar-class';

export type FillBarProps = {
  readonly percent: number;
  /** What the bar measures, for assistive tech: "24 of 32 places taken". */
  readonly label: string;
};

export function FillBar({ percent, label }: FillBarProps) {
  return (
    <span role="img" aria-label={label} className={fillTrackClass()}>
      <span className={fillBarClass(percent)} />
    </span>
  );
}
