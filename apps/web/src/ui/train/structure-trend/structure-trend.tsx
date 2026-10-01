import { TrainCard } from '../card/train-card';
import {
  areaPath,
  gridlines,
  linePath,
  plot,
  trendPoints,
} from './trend-geometry';

export type StructureTrendProps = {
  /** Percent complete on the first check, oldest week first. */
  readonly trend: readonly number[];
};

/** The first-check trend as a small line chart over sample data. */
export function StructureTrend({ trend }: StructureTrendProps) {
  const points = trendPoints(trend);
  const last = points[points.length - 1];
  const from = trend[0];
  const to = trend[trend.length - 1];
  return (
    <TrainCard title="Structure on the first check" level={3} sample>
      <p className="text-sm text-ink-muted">
        Arguments with a claim, warrant and impact the first time you checked,
        by week.
      </p>
      <svg
        viewBox="0 0 440 190"
        role="img"
        aria-label={`Sample chart: arguments with claim, warrant and impact on the first check, from ${from} to ${to} percent over ${trend.length} weeks`}
        className="block w-full max-w-search"
      >
        {gridlines.map((line) => (
          <g key={line.label}>
            <line
              x1={plot.left}
              x2={plot.right}
              y1={line.y}
              y2={line.y}
              className="stroke-border"
            />
            <text
              x={plot.left - 8}
              y={line.y + 4}
              textAnchor="end"
              className="fill-ink-faint text-xs"
            >
              {line.label}
            </text>
          </g>
        ))}
        <path d={areaPath(points)} className="fill-accent-soft" />
        <path
          d={linePath(points)}
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          className="fill-none stroke-accent"
        />
        {last ? (
          <>
            <circle cx={last.x} cy={last.y} r={5} className="fill-accent" />
            <text
              x={last.x - 2}
              y={last.y - 12}
              textAnchor="end"
              className="fill-ink text-sm font-bold"
            >{`${to}%`}</text>
          </>
        ) : null}
        <text x={plot.left} y={182} className="fill-ink-faint text-xs">
          {`${trend.length} weeks ago`}
        </text>
        <text
          x={plot.right}
          y={182}
          textAnchor="end"
          className="fill-ink-faint text-xs"
        >
          This week
        </text>
      </svg>
    </TrainCard>
  );
}
