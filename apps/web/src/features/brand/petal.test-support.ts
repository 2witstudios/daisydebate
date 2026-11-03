/** Test support for SVG path strings the petal geometry draws. */

/** Every coordinate pair the path passes through or steers by. */
export const pointsOf = (
  path: string,
): readonly (readonly [number, number])[] => {
  const numbers = path.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  return numbers.flatMap((value, index) =>
    index % 2 === 0 ? [[value, numbers[index + 1] ?? Number.NaN] as const] : [],
  );
};
