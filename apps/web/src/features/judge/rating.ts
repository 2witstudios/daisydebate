/**
 * The judge rating and the ballots behind it. The owner has not defined
 * this concept: no ADR says what feeds it or how it scales, so everything
 * here is a display model for sample data (one private rating per judge,
 * provisional until enough ballots have debater feedback). The backend read
 * that defines it replaces `getJudgeRating` and this type with it.
 */

export type RatingStatus = 'provisional' | 'established';

/** Who the ballot's decision went to (ADR 0029: `decision` aff, neg, draw). */
export type BallotDecision = 'aff' | 'neg' | 'draw';

export type RecentBallot = {
  readonly id: string;
  readonly debateLabel: string;
  readonly daysAgo: number;
  readonly decision: BallotDecision;
  /** Debaters who marked the reason helpful, out of those who answered. */
  readonly helpful: number;
  readonly answered: number;
  /** Anonymous debater comment; never carries who wrote it. */
  readonly comment: string | null;
  /** The review outcome, when the ballot was reviewed. */
  readonly review: string | null;
  /** The ballot's effect on the rating. */
  readonly delta: number;
};

export type JudgeRating = {
  /** Sample season label; seasons are not modelled yet. */
  readonly season: string;
  readonly status: RatingStatus;
  readonly rating: number;
  readonly ballotsWithFeedback: number;
  /** Ballots with feedback needed to become established. */
  readonly threshold: number;
  /** Rating after each recent ballot, oldest first. */
  readonly series: readonly number[];
  readonly recent: readonly RecentBallot[];
};

/** "1,388": thousands grouped the same way on every host. */
export const formatRating = (rating: number): string =>
  rating.toLocaleString('en-US');

/** Share of the way to established, 0 to 100. */
export const ratingProgress = (rating: JudgeRating): number =>
  rating.status === 'established'
    ? 100
    : Math.min(
        100,
        Math.round((rating.ballotsWithFeedback / rating.threshold) * 100),
      );

export const progressLine = (rating: JudgeRating): string =>
  rating.status === 'established'
    ? 'Established. Your rating now changes more slowly.'
    : `${rating.ballotsWithFeedback} of ${rating.threshold} ballots with feedback to become established`;

export const statusLabel = (status: RatingStatus): string =>
  status === 'established' ? 'Established' : 'Provisional';

const decisions: Readonly<Record<BallotDecision, string>> = {
  aff: 'Aff wins',
  neg: 'Neg wins',
  draw: 'Draw',
};

export const decisionLabel = (decision: BallotDecision): string =>
  decisions[decision];

export const feedbackLabel = ({
  helpful,
  answered,
}: Pick<RecentBallot, 'helpful' | 'answered'>): string =>
  `${helpful} of ${answered} marked helpful`;

export const daysAgoLabel = (days: number): string =>
  days <= 0 ? 'Today' : days === 1 ? '1 day ago' : `${days} days ago`;

/** "+6", "−4" (a real minus sign) or "0". */
export const deltaLabel = (delta: number): string =>
  delta > 0 ? `+${delta}` : delta < 0 ? `−${Math.abs(delta)}` : '0';

export type DeltaTone = 'up' | 'down' | 'flat';

export const deltaTone = (delta: number): DeltaTone =>
  delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';

export type Sparkline = {
  /** SVG `points` for the polyline, one per rating. */
  readonly points: string;
  readonly last: { readonly x: number; readonly y: number };
};

const round1 = (value: number): number => Math.round(value * 10) / 10;

/**
 * Maps a rating series onto a `width` by `height` box with `pad` on every
 * side. A flat series draws as a level line through the middle.
 */
export function sparkline(
  series: readonly number[],
  { width, height, pad }: { width: number; height: number; pad: number },
): Sparkline {
  const low = Math.min(...series);
  const span = Math.max(...series) - low;
  const steps = Math.max(1, series.length - 1);
  const coords = series.map((value, index) => ({
    x: round1(pad + (index * (width - 2 * pad)) / steps),
    y: round1(
      span === 0
        ? height / 2
        : height - pad - ((value - low) / span) * (height - 2 * pad),
    ),
  }));
  return {
    points: coords.map(({ x, y }) => `${x},${y}`).join(' '),
    last: coords[coords.length - 1] ?? { x: pad, y: height / 2 },
  };
}
