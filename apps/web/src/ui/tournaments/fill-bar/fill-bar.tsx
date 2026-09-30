import { fillBarClass, fillTrackClass, type FillTone } from './fill-bar-class';

export type FillBarProps = {
  readonly percent: number;
  /** What the bar measures, for assistive tech: "24 of 32 places taken". */
  readonly label: string;
  readonly tone?: FillTone;
};

export function FillBar({ percent, label, tone = 'default' }: FillBarProps) {
  return (
    <span role="img" aria-label={label} className={fillTrackClass(tone)}>
      <span className={fillBarClass(percent, tone)} />
    </span>
  );
}
