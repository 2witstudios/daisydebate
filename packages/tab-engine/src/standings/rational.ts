import type { Rational } from '../shapes/folds';

/** Exact fractions in lowest terms: integers only, never a float. */
const gcd = (a: number, b: number): number =>
  b === 0 ? Math.abs(a) : gcd(b, a % b);

export const rational = (n: number, d = 1): Rational => {
  const sign = d < 0 ? -1 : 1;
  const divisor = gcd(n, d) || 1;
  return { n: (sign * n) / divisor || 0, d: (sign * d) / divisor };
};

export const zero = rational(0);

const add = (a: Rational, b: Rational) =>
  rational(a.n * b.d + b.n * a.d, a.d * b.d);

export const multiply = (a: Rational, b: Rational) =>
  rational(a.n * b.n, a.d * b.d);

export const sum = (values: readonly Rational[]) => values.reduce(add, zero);

/** Negative, zero or positive, by cross-multiplication. */
export const compareRational = (a: Rational, b: Rational) =>
  a.n * b.d - b.n * a.d;

/** Lexicographic; a vector that is a prefix of another sorts first. */
export const compareVector = (
  a: readonly Rational[],
  b: readonly Rational[],
): number => {
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    const order = compareRational(a[i]!, b[i]!);
    if (order !== 0) return order;
  }
  return a.length - b.length;
};
