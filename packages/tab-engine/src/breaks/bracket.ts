/** The standard seeded order of a bracket of `size` (a power of two), 1-based. */
const seededOrder = (size: number): number[] => {
  let order = [1];
  while (order.length < size) {
    const n = 2 * order.length + 1;
    order = order.flatMap((s, i) => (i % 2 === 0 ? [s, n - s] : [n - s, s]));
  }
  return order;
};

/**
 * The first tab round of the standard seeded tree, as 0-based seed indices
 * in bracket order, the better seed first: for 16, 1 v 16, 8 v 9, 5 v 12,
 * 4 v 13, 3 v 14, 6 v 11, 7 v 10, 2 v 15, so seeds 1 and 2 can only meet in
 * the final. A field that is not a power of two fills the next one up; the
 * missing seeds are byes, `[seed, null]`, and so fall to the top seeds.
 */
export const bracketFirstRound = (
  seedCount: number,
): readonly (readonly [number, number | null])[] => {
  if (seedCount <= 0) return [];
  let size = 1;
  while (size < seedCount) size *= 2;
  const order = seededOrder(size);
  if (size === 1) return [[0, null]];
  return Array.from({ length: size / 2 }, (_, i) => {
    const [a, b] = [order[2 * i]!, order[2 * i + 1]!];
    const [high, low] = a < b ? [a, b] : [b, a];
    return [high - 1, low <= seedCount ? low - 1 : null] as const;
  });
};
