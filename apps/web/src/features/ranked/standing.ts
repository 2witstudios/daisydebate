/**
 * What the Ranked page shows about the viewer: one rating for the season
 * (ADR 0029), provisional until enough debates, or none before the first.
 */
export type RankedRating =
  | { readonly kind: 'unrated' }
  | {
      readonly kind: 'provisional' | 'established';
      readonly value: number;
    };

export type RatingKind = RankedRating['kind'];

export type Season = {
  readonly number: number;
  readonly daysLeft: number;
};

export type RankedStanding = {
  readonly rating: RankedRating;
  readonly season: Season;
};

export type RatingDisplay = {
  readonly kind: RatingKind;
  /** The big figure: the rating, or the word Unrated. */
  readonly figure: string;
  /** The status pill beside it. */
  readonly status: string;
};

const statusLabels: Readonly<Record<RatingKind, string>> = {
  unrated: 'Unrated',
  provisional: 'Provisional',
  established: 'Established',
};

export const describeRating = (rating: RankedRating): RatingDisplay => ({
  kind: rating.kind,
  figure: rating.kind === 'unrated' ? 'Unrated' : String(rating.value),
  status: statusLabels[rating.kind],
});

export const seasonLine = ({ number, daysLeft }: Season): string =>
  `Season ${number} · ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left`;

/** A hint under the rating; only an unrated player needs one. */
export const ratingNote = (rating: RankedRating): string | null =>
  rating.kind === 'unrated'
    ? 'Your first ranked debate sets your rating.'
    : null;
