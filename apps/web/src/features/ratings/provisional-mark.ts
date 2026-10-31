/**
 * The compact provisional mark: a rating that is not yet real ends in `*`
 * and reads italic. Narrow inline spots (the rail's ratings, profile and
 * round lines, a ladder row) use the mark instead of spelling the word,
 * which wraps; roomy surfaces and accessible names keep saying Provisional.
 */
export const provisionalMark = '*';

/** The figure class that carries the mark. */
export const provisionalMarkClass = 'italic';

/** The rating as a compact inline spot shows it, marked while provisional.
 * The provisional figure is a whole number: precision it has not earned. */
export const markedRating = (rating: number, provisional: boolean): string =>
  provisional ? `${Math.round(rating)}${provisionalMark}` : `${rating}`;
