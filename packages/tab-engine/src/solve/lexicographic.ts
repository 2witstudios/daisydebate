/**
 * Ranked criteria as one integer weight. Each field is sized from its
 * largest possible total over a whole plan, so a lower field can never carry
 * into a higher one: minimising the packed sum is exactly minimising the
 * fields in order (field 0 first).
 */
const bitLength = (value: bigint) => {
  let bits = 0n;
  for (let rest = value; rest > 0n; rest >>= 1n) bits += 1n;
  return bits;
};

/**
 * Packs each candidate's cost vector. `parts` is how many candidates one
 * plan sums (the fixtures of a matching, the seats of an assignment).
 */
export const packLexicographic = (
  vectors: readonly (readonly number[])[],
  parts: number,
): bigint[] => {
  if (vectors.length === 0) return [];
  const width = vectors[0]!.length;
  const largest = Array.from({ length: width }, (_, f) =>
    vectors.reduce((m, vector) => Math.max(m, vector[f]!), 0),
  );
  const bits = largest.map((m) =>
    bitLength(BigInt(m) * BigInt(Math.max(parts, 1))),
  );
  const shifts: bigint[] = Array.from({ length: width }, () => 0n);
  for (let f = width - 2; f >= 0; f -= 1)
    shifts[f] = shifts[f + 1]! + bits[f + 1]!;
  return vectors.map((vector) =>
    vector.reduce((sum, value, f) => sum + (BigInt(value) << shifts[f]!), 0n),
  );
};

/** Lexicographic comparison of two cost vectors of equal length. */
export const compareVectors = (a: readonly number[], b: readonly number[]) => {
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
};

export const addVectors = (a: readonly number[], b: readonly number[]) =>
  a.map((value, i) => value + b[i]!);
