import { sparkline } from '../../../features/judge/rating';

export type RatingChartProps = {
  readonly series: readonly number[];
};

const box = { width: 420, height: 84, pad: 8 };

/** The rating after each recent ballot, as a small trend line. */
export function RatingChart({ series }: RatingChartProps) {
  const { points, last } = sparkline(series, box);
  return (
    <svg
      viewBox={`0 0 ${box.width} ${box.height}`}
      role="img"
      aria-label="Your rating over recent ballots"
      className="h-auto w-full text-accent"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={last.x} cy={last.y} r={4.5} fill="currentColor" />
    </svg>
  );
}
