import { z } from 'zod';
import type { BallotPoints } from './ballot-definition';

type Fraction = { readonly numerator: bigint; readonly denominator: bigint };
const gcd = (a: bigint, b: bigint): bigint => {
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
};
const fraction = (numerator: bigint, denominator: bigint): Fraction => {
  const divisor = gcd(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
};

/** Decimal spelling is the authored value; IEEE arithmetic never rounds a score. */
const decimalFraction = (value: number): Fraction | null => {
  if (!Number.isFinite(value) || value < 0) return null;
  const [coefficient = '', exponent = '0'] = value
    .toString()
    .toLowerCase()
    .split('e');
  const [whole = '', decimals = ''] = coefficient.split('.');
  const places = decimals.length - Number(exponent);
  const digits = BigInt(`${whole}${decimals}`);
  return fraction(
    digits * 10n ** BigInt(Math.max(0, -places)),
    10n ** BigInt(Math.max(0, places)),
  );
};
const positiveInteger = z
  .string()
  .regex(/^[1-9]\d*$/)
  .max(1024);
/** One engine point is this many of the ballot's score units. */
export const scoreUnitSchema = z
  .strictObject({
    numerator: positiveInteger,
    denominator: positiveInteger,
  })
  .refine(
    (unit) =>
      positiveInteger.safeParse(unit.numerator).success &&
      positiveInteger.safeParse(unit.denominator).success &&
      gcd(BigInt(unit.numerator), BigInt(unit.denominator)) === 1n,
    'A score unit is a reduced positive fraction',
  );
export type ScoreUnit = z.infer<typeof scoreUnitSchema>;

/** One common unit for every fixture using this definition's scale and weights. */
export const scoreUnitFor = (points: BallotPoints): ScoreUnit | null => {
  const step = decimalFraction(points.scale.step);
  const minimum = decimalFraction(points.scale.min);
  if (!step || !minimum || step.numerator === 0n) return null;
  const weights =
    points.per === 'speech' ? [1, ...Object.values(points.weights ?? {})] : [1];
  let unit: Fraction | null = null;
  for (const weight of weights) {
    const factor = decimalFraction(weight);
    if (!factor || factor.numerator === 0n) return null;
    const weighted = fraction(
      step.numerator * factor.numerator,
      step.denominator * factor.denominator,
    );
    const offset = fraction(
      minimum.numerator * factor.numerator,
      minimum.denominator * factor.denominator,
    );
    for (const amount of [weighted, offset]) {
      if (amount.numerator === 0n) continue;
      unit =
        unit === null
          ? amount
          : fraction(
              gcd(
                unit.numerator * amount.denominator,
                amount.numerator * unit.denominator,
              ),
              unit.denominator * amount.denominator,
            );
    }
  }
  return unit === null
    ? null
    : {
        numerator: unit.numerator.toString(),
        denominator: unit.denominator.toString(),
      };
};

/** A non-integral or unsafe score has no integer engine representation. */
export const scoreUnits = (
  value: number,
  unit: ScoreUnit,
):
  | { readonly kind: 'exact'; readonly units: number }
  | { readonly kind: 'unrepresentable' } => {
  const amount = decimalFraction(value);
  const parsed = scoreUnitSchema.safeParse(unit);
  if (!amount || !parsed.success) return { kind: 'unrepresentable' };
  const numerator = amount.numerator * BigInt(parsed.data.denominator);
  const denominator = amount.denominator * BigInt(parsed.data.numerator);
  if (
    numerator % denominator !== 0n ||
    numerator / denominator > BigInt(Number.MAX_SAFE_INTEGER)
  )
    return { kind: 'unrepresentable' };
  return { kind: 'exact', units: Number(numerator / denominator) };
};

/** The finest common unit required by the actual pinned definitions in a fold. */
export const commonScoreUnit = (
  units: readonly ScoreUnit[],
): ScoreUnit | null => {
  let common: Fraction | null = null;
  for (const unit of units) {
    if (!scoreUnitSchema.safeParse(unit).success) return null;
    const next = {
      numerator: BigInt(unit.numerator),
      denominator: BigInt(unit.denominator),
    };
    common =
      common === null
        ? next
        : fraction(
            gcd(
              common.numerator * next.denominator,
              next.numerator * common.denominator,
            ),
            common.denominator * next.denominator,
          );
  }
  return common
    ? {
        numerator: common.numerator.toString(),
        denominator: common.denominator.toString(),
      }
    : null;
};

/** Convert existing integer contributions; a fractional or unsafe answer refuses. */
export const convertScoreUnits = (
  units: number,
  from: ScoreUnit,
  to: ScoreUnit,
): ReturnType<typeof scoreUnits> => {
  if (
    !Number.isSafeInteger(units) ||
    units < 0 ||
    !scoreUnitSchema.safeParse(from).success ||
    !scoreUnitSchema.safeParse(to).success
  )
    return { kind: 'unrepresentable' };
  const numerator =
    BigInt(units) * BigInt(from.numerator) * BigInt(to.denominator);
  const denominator = BigInt(from.denominator) * BigInt(to.numerator);
  if (
    numerator % denominator !== 0n ||
    numerator / denominator > BigInt(Number.MAX_SAFE_INTEGER)
  )
    return { kind: 'unrepresentable' };
  return { kind: 'exact', units: Number(numerator / denominator) };
};

const weightedFraction = (value: number, weight: number): Fraction | null => {
  const amount = decimalFraction(value),
    factor = decimalFraction(weight);
  return amount && factor && factor.numerator > 0n
    ? fraction(
        amount.numerator * factor.numerator,
        amount.denominator * factor.denominator,
      )
    : null;
};
/** Numeric schema bounds use the reduced exact product, never binary multiplication. */
export const scoreBounds = (scale: BallotPoints['scale'], weight: number) => {
  const minimum = weightedFraction(scale.min, weight),
    maximum = weightedFraction(scale.max, weight),
    increment = weightedFraction(scale.step, weight);
  if (!minimum || !maximum || !increment) return null;
  const min = Number(minimum.numerator) / Number(minimum.denominator),
    max = Number(maximum.numerator) / Number(maximum.denominator);
  const step = Number(increment.numerator) / Number(increment.denominator);
  return Number.isFinite(min) && Number.isFinite(max) && Number.isFinite(step)
    ? { min, max, step }
    : null;
};
/** The authored lattice is (score - minimum × weight) / (step × weight). */
export const isScoreOnScale = (
  value: number,
  scale: BallotPoints['scale'],
  weight = 1,
): boolean => {
  const amount = decimalFraction(value),
    minimum = weightedFraction(scale.min, weight),
    maximum = weightedFraction(scale.max, weight),
    step = weightedFraction(scale.step, weight);
  if (!amount || !minimum || !maximum || !step || step.numerator === 0n)
    return false;
  const delta =
    amount.numerator * minimum.denominator -
    minimum.numerator * amount.denominator;
  if (
    delta < 0n ||
    amount.numerator * maximum.denominator >
      maximum.numerator * amount.denominator
  )
    return false;
  return (
    (delta * step.denominator) %
      (amount.denominator * minimum.denominator * step.numerator) ===
    0n
  );
};

/** A conservative integer capacity bound, never a normalized submitted score. */
export const scoreCapacity = (
  maximum: number,
  unit: ScoreUnit,
  weight = 1,
): number | null => {
  const amount = weightedFraction(maximum, weight);
  if (!amount || !scoreUnitSchema.safeParse(unit).success) return null;
  const numerator = amount.numerator * BigInt(unit.denominator);
  const denominator = amount.denominator * BigInt(unit.numerator);
  const capacity = (numerator + denominator - 1n) / denominator;
  return capacity <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(capacity) : null;
};

const lattice = (scale: BallotPoints['scale'], weight: number) => {
  const minimum = weightedFraction(scale.min, weight),
    maximum = weightedFraction(scale.max, weight),
    step = weightedFraction(scale.step, weight);
  if (!minimum || !maximum || !step || step.numerator === 0n) return null;
  const distance =
    maximum.numerator * minimum.denominator -
    minimum.numerator * maximum.denominator;
  if (distance < 0n) return null;
  return {
    minimum,
    step,
    count:
      (distance * step.denominator) /
        (maximum.denominator * minimum.denominator * step.numerator) +
      1n,
  };
};
export const scoreLatticeSize = (
  scale: BallotPoints['scale'],
  weight = 1,
): number | null => {
  const values = lattice(scale, weight);
  return values && values.count <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(values.count)
    : null;
};
/** An indexed legal score, without allocating the full scale or rounding a score. */
export const scoreValueAt = (
  scale: BallotPoints['scale'],
  index: number,
  weight = 1,
): number | null => {
  const values = lattice(scale, weight);
  if (
    !values ||
    !Number.isSafeInteger(index) ||
    index < 0 ||
    BigInt(index) >= values.count
  )
    return null;
  const amount = fraction(
    values.minimum.numerator * values.step.denominator +
      BigInt(index) * values.step.numerator * values.minimum.denominator,
    values.minimum.denominator * values.step.denominator,
  );
  const value = Number(amount.numerator) / Number(amount.denominator);
  return isScoreOnScale(value, scale, weight) ? value : null;
};
/** Small wire-schema enums only; large scales remain numeric with exact local validation. */
export const scoreLatticeValues = (
  scale: BallotPoints['scale'],
  weight = 1,
): readonly number[] | null => {
  const count = scoreLatticeSize(scale, weight);
  if (count === null || count > 1024) return null;
  const values: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const value = scoreValueAt(scale, index, weight);
    if (value === null) return null;
    values.push(value);
  }
  return values;
};

/** The exact displayed scale and explicit default for one actual scored subject. */
export const scoreScaleFor = (
  points: BallotPoints,
  subject: string,
): {
  readonly scale: BallotPoints['scale'];
  readonly default: number;
} | null => {
  const weight = points.per === 'speech' ? (points.weights?.[subject] ?? 1) : 1;
  const scale = scoreBounds(points.scale, weight);
  const start = weightedFraction(points.default, weight);
  if (!scale || !start) return null;
  const value = Number(start.numerator) / Number(start.denominator);
  return isScoreOnScale(value, scale) ? { scale, default: value } : null;
};

/** Sum authored decimal values exactly before one final numeric display/comparison. */
export const sumScoreValues = (values: readonly number[]): number => {
  let total: Fraction = { numerator: 0n, denominator: 1n };
  for (const value of values) {
    const next = decimalFraction(value);
    if (!next) return Number.NaN;
    total = fraction(
      total.numerator * next.denominator + next.numerator * total.denominator,
      total.denominator * next.denominator,
    );
  }
  return Number(total.numerator) / Number(total.denominator);
};
