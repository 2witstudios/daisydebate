import type { ChangeEvent, MouseEvent, ReactNode } from 'react';
import type {
  ChartGeometry,
  Readout,
} from '../../../features/leaderboard/history';

export type RatingChartRenderProps = {
  readonly chart: ChartGeometry;
  readonly label: string;
  readonly step: number;
  readonly lastStep: number;
  readonly readout: Readout;
  /** The slider and pointer scrubbing only exist once a script can run. */
  readonly interactive: boolean;
  readonly onStep: (step: number) => void;
  readonly onPointer: (event: MouseEvent<SVGSVGElement>) => void;
};

/** The chart and its readout as markup. The line, band and axes are SVG. */
export function renderRatingChart(props: RatingChartRenderProps): ReactNode {
  const { chart, step, readout } = props;
  const dot = chart.dots[step];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-display text-xl font-bold tabular-nums">
          {readout.value}
        </span>
        <span className="text-sm text-ink-muted">{readout.heading}</span>
      </div>
      <p aria-live="polite" className="text-sm text-ink-muted">
        {readout.detail}
      </p>
      <svg
        viewBox={chart.viewBox}
        role="img"
        aria-label={props.label}
        className="w-full"
        onMouseMove={props.interactive ? props.onPointer : undefined}
      >
        {chart.yTicks.map((tick) => (
          <g key={tick.y}>
            <line
              x1={chart.plot.left}
              x2={chart.plot.right}
              y1={tick.y}
              y2={tick.y}
              strokeWidth="1"
              className="stroke-border"
            />
            <text
              x={chart.plot.left - 6}
              y={tick.y + 3}
              textAnchor="end"
              className="fill-ink-faint text-2xs"
            >
              {tick.label}
            </text>
          </g>
        ))}
        {chart.xTicks.map((tick) => (
          <text
            key={tick.x}
            x={tick.x}
            y={chart.plot.bottom + 16}
            textAnchor="middle"
            className="fill-ink-faint text-2xs"
          >
            {tick.label}
          </text>
        ))}
        <path d={chart.band} className="fill-accent-soft" />
        {chart.establishedX === null ? null : (
          <line
            x1={chart.establishedX}
            x2={chart.establishedX}
            y1={chart.plot.top}
            y2={chart.plot.bottom}
            strokeWidth="1"
            strokeDasharray="3 3"
            className="stroke-ink-faint"
          />
        )}
        <path
          d={chart.line}
          fill="none"
          strokeWidth="2"
          className="stroke-accent"
        />
        {dot ? (
          <circle cx={dot.x} cy={dot.y} r="4" className="fill-accent" />
        ) : null}
      </svg>
      {props.interactive ? (
        <label className="flex flex-col gap-1 text-sm text-ink-faint">
          Step through debates
          <input
            type="range"
            min={0}
            max={props.lastStep}
            value={step}
            className="w-full accent-accent"
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              props.onStep(Number(event.target.value))
            }
          />
        </label>
      ) : null}
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-faint">
        <li>Rating</li>
        <li>95% range</li>
        {chart.establishedX === null ? null : <li>Established</li>}
      </ul>
    </div>
  );
}
