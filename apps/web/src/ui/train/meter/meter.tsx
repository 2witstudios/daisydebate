import { segmentClass, type MeterTone } from './meter-class';

export type MeterProps = {
  /** Percent, 0 to 100. */
  readonly value: number;
  readonly label: string;
  readonly tone?: MeterTone;
};

const SEGMENTS = 20;

/**
 * A segmented bar. Segments, not a sized fill, because markup carries no
 * inline width (ADR 0028); the value is also on the element for readers.
 */
export function Meter({ value, label, tone = 'accent' }: MeterProps) {
  const percent = Math.max(0, Math.min(100, Math.round(value)));
  const filled = Math.round((percent / 100) * SEGMENTS);
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="flex gap-1"
    >
      {Array.from({ length: SEGMENTS }, (_, index) => (
        <span key={index} className={segmentClass(index < filled, tone)} />
      ))}
    </div>
  );
}
