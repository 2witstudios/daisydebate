/**
 * Minimum-cost assignment of every row to a distinct column (the Hungarian
 * method with potentials, Kuhn 1955 and Munkres 1957), O(rows² · columns).
 * `null` in the cost table is a forbidden pair. Returns each row's column,
 * or null when no assignment avoids every forbidden pair.
 */
export const minimumCostAssignment = (
  costs: readonly (readonly (bigint | null)[])[],
): number[] | null => {
  const rows = costs.length;
  if (rows === 0) return [];
  const columns = costs[0]!.length;
  if (rows > columns) return null;
  const largest = costs.reduce(
    (m, row) => row.reduce<bigint>((inner, c) => (c !== null && c > inner ? c : inner), m),
    0n,
  );
  /** Above any sum of allowed costs, so it is chosen only when nothing else fits. */
  const forbidden = (largest + 1n) * BigInt(rows + 1);
  const cost = (i: number, j: number) => costs[i - 1]![j - 1] ?? forbidden;
  const u: bigint[] = Array.from({ length: rows + 1 }, () => 0n);
  const v: bigint[] = Array.from({ length: columns + 1 }, () => 0n);
  const owner = Array.from({ length: columns + 1 }, () => 0);
  const way = Array.from({ length: columns + 1 }, () => 0);
  for (let i = 1; i <= rows; i += 1) {
    owner[0] = i;
    let j0 = 0;
    const minv: (bigint | null)[] = Array.from({ length: columns + 1 }, () => null);
    const used = Array.from({ length: columns + 1 }, () => false);
    do {
      used[j0] = true;
      const i0 = owner[j0]!;
      let delta: bigint | null = null;
      let j1 = 0;
      for (let j = 1; j <= columns; j += 1)
        if (!used[j]) {
          const reduced = cost(i0, j) - u[i0]! - v[j]!;
          if (minv[j] === null || reduced < minv[j]!) {
            minv[j] = reduced;
            way[j] = j0;
          }
          if (delta === null || minv[j]! < delta) {
            delta = minv[j]!;
            j1 = j;
          }
        }
      for (let j = 0; j <= columns; j += 1)
        if (used[j]) {
          u[owner[j]!] = u[owner[j]!]! + delta!;
          v[j] = v[j]! - delta!;
        } else minv[j] = minv[j]! - delta!;
      j0 = j1;
    } while (owner[j0] !== 0);
    do {
      const j1 = way[j0]!;
      owner[j0] = owner[j1]!;
      j0 = j1;
    } while (j0 !== 0);
  }
  const assigned = Array.from({ length: rows }, () => -1);
  for (let j = 1; j <= columns; j += 1) if (owner[j]! > 0) assigned[owner[j]! - 1] = j - 1;
  return assigned.every((column, row) => costs[row]![column] != null) ? assigned : null;
};
