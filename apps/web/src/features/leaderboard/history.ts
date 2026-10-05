/**
 * One point of a debater's season: the rating and deviation after a ranked
 * debate (ADR 0029 `rating_changes`). Game 0 is the season start, which has
 * no result or opponent.
 */
export type RatingPoint = {
  readonly game: number;
  readonly rating: number;
  readonly deviation: number;
  readonly result: 'won' | 'lost' | null;
  /** Public username of the opponent; null at the season start. */
  readonly opponent: string | null;
};

export type Scale = (value: number) => number;

/** A linear map from a domain onto a range, with no clamping. */
export const linearScale =
  (
    [d0, d1]: readonly [number, number],
    [r0, r1]: readonly [number, number],
  ): Scale =>
  (value) =>
    d1 === d0 ? r0 : r0 + ((value - d0) / (d1 - d0)) * (r1 - r0);

const round1 = (value: number): number => Math.round(value * 10) / 10;

/** An SVG path through the points: M x y, then L x y for each after. */
export const linePath = (
  coords: readonly (readonly [number, number])[],
): string =>
  coords
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${round1(x)} ${round1(y)}`)
    .join('');

/** Chart size in viewBox units, and the plot's margins inside it. */
const CHART = {
  width: 420,
  height: 190,
  left: 40,
  right: 14,
  top: 12,
  bottom: 26,
} as const;

/** The 95% range around a rating is twice its deviation. */
const RANGE = 2;

export type ChartGeometry = {
  readonly viewBox: string;
  readonly plot: {
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
  };
  readonly line: string;
  readonly band: string;
  readonly yTicks: readonly { readonly y: number; readonly label: string }[];
  readonly xTicks: readonly { readonly x: number; readonly label: string }[];
  /** Screen position of every point, game order. */
  readonly dots: readonly { readonly x: number; readonly y: number }[];
  /** Where the rating became established, or null if it has not. */
  readonly establishedX: number | null;
};

/**
 * The rating-history chart as numbers: the line, its 95% band and the axes.
 * The vertical axis starts near the lowest rating, not at zero, because
 * rating is an interval scale. `establishedAt` is the game the rating
 * became established.
 */
export function chartGeometry(
  points: readonly RatingPoint[],
  establishedAt: number | null,
): ChartGeometry {
  const last = Math.max(1, points.at(-1)?.game ?? 1);
  const ratings = points.map((point) => point.rating);
  const min = Math.floor((Math.min(...ratings) - 15) / 50) * 50;
  const span = Math.ceil((Math.max(...ratings) + 15 - min) / 150) * 150;
  const top = CHART.top;
  const bottom = CHART.height - CHART.bottom;
  const right = CHART.width - CHART.right;
  const x = linearScale([0, last], [CHART.left, right]);
  const y = linearScale([min, min + span], [bottom, top]);
  const clampY = (value: number): number =>
    Math.min(bottom, Math.max(top, y(value)));

  const upper = points.map((p): [number, number] => [
    x(p.game),
    clampY(p.rating + RANGE * p.deviation),
  ]);
  const lower = points
    .map((p): [number, number] => [
      x(p.game),
      clampY(p.rating - RANGE * p.deviation),
    ])
    .reverse();
  const middle = Math.round(last / 2);
  return {
    viewBox: `0 0 ${CHART.width} ${CHART.height}`,
    plot: { left: CHART.left, right, top, bottom },
    line: linePath(points.map((p) => [x(p.game), y(p.rating)])),
    band: `${linePath(upper)}${linePath(lower).replace('M', 'L')}Z`,
    yTicks: [0, 1, 2, 3].map((k) => ({
      y: round1(bottom - ((bottom - top) * k) / 3),
      label: String(min + (span * k) / 3),
    })),
    xTicks: [0, middle, last].map((game) => ({
      x: round1(x(game)),
      label: String(game),
    })),
    dots: points.map((p) => ({ x: round1(x(p.game)), y: round1(y(p.rating)) })),
    establishedX: establishedAt === null ? null : round1(x(establishedAt)),
  };
}

export const signed = (amount: number): string =>
  `${amount > 0 ? '+' : amount < 0 ? '−' : ''}${Math.abs(amount)}`;

export type Readout = {
  readonly heading: string;
  readonly value: string;
  readonly detail: string;
};

/** The chart's readout at a step; a step past the ends is clamped. */
export function readoutAt(
  points: readonly RatingPoint[],
  step: number | null,
): Readout {
  const last = points.length - 1;
  const at = Math.min(last, Math.max(0, step ?? last));
  const point = points[at];
  const before = points[at - 1];
  if (!point || !before || at === 0)
    return {
      heading: 'Season start',
      value: `${point?.rating ?? 0} ± ${RANGE * (point?.deviation ?? 0)}`,
      detail: 'Starting rating',
    };
  return {
    heading: `Debate ${at} of ${last}`,
    value: `${point.rating} ± ${RANGE * point.deviation}`,
    detail: `${point.result === 'won' ? 'Won' : 'Lost'} vs @${point.opponent} (${signed(point.rating - before.rating)})`,
  };
}

/** The furthest step the readout can reach. */
export const lastStep = (points: readonly RatingPoint[]): number =>
  Math.max(0, points.length - 1);

export const peakRating = (points: readonly RatingPoint[]): number =>
  Math.max(...points.slice(1).map((point) => point.rating));

export type ResultRow = {
  readonly game: number;
  readonly result: 'Won' | 'Lost';
  readonly opponent: string;
  readonly change: string;
  readonly up: boolean;
  readonly rating: number;
};

/** Every ranked debate, newest first: the chart's table alternative. */
export function resultRows(
  points: readonly RatingPoint[],
): readonly ResultRow[] {
  return points
    .slice(1)
    .map((point, i): ResultRow => {
      const delta = point.rating - (points[i]?.rating ?? point.rating);
      return {
        game: point.game,
        result: point.result === 'won' ? 'Won' : 'Lost',
        opponent: point.opponent ?? '',
        change: signed(delta),
        up: delta >= 0,
        rating: point.rating,
      };
    })
    .reverse();
}
