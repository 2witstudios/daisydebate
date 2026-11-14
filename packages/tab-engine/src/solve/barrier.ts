import { maximumWeightMatching } from './matching';

/**
 * A Tutte barrier: a set of vertices whose removal leaves more components of
 * odd size than the set has members, which proves no perfect matching
 * exists (Tutte 1947). Found by the Gallai–Edmonds decomposition: D is every
 * vertex some maximum matching misses, and the barrier is D's neighbours
 * outside D. Anyone can verify it by counting components; null when the
 * graph has a perfect matching.
 */
export const tutteBarrier = (
  vertexCount: number,
  edges: readonly (readonly [number, number])[],
): number[] | null => {
  const size = (without: number) => {
    const kept = edges.filter(([i, j]) => i !== without && j !== without);
    return maximumWeightMatching(
      vertexCount,
      kept.map(([i, j]) => [i, j, 1n] as const),
    ).filter((partner) => partner >= 0).length;
  };
  const full = size(-1);
  if (full === vertexCount) return null;
  const missable = new Set(
    Array.from({ length: vertexCount }, (_, v) => v).filter(
      (v) => size(v) === full,
    ),
  );
  const barrier = new Set<number>();
  for (const [i, j] of edges) {
    if (missable.has(i) && !missable.has(j)) barrier.add(j);
    if (missable.has(j) && !missable.has(i)) barrier.add(i);
  }
  return [...barrier].sort((a, b) => a - b);
};

/** How many components of odd size remain once the barrier is removed. */
export const oddComponentsWithout = (
  vertexCount: number,
  edges: readonly (readonly [number, number])[],
  removed: ReadonlySet<number>,
) => {
  const parent = Array.from({ length: vertexCount }, (_, v) => v);
  const root = (v: number): number =>
    parent[v] === v ? v : (parent[v] = root(parent[v]!));
  for (const [i, j] of edges)
    if (!removed.has(i) && !removed.has(j)) parent[root(i)] = root(j);
  const sizes = new Map<number, number>();
  for (let v = 0; v < vertexCount; v += 1)
    if (!removed.has(v)) sizes.set(root(v), (sizes.get(root(v)) ?? 0) + 1);
  return [...sizes.values()].filter((n) => n % 2 === 1).length;
};
