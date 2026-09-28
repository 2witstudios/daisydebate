/**
 * The Daisy petal primitive (ADR 0045): a teardrop with a rounded outer bulb
 * and a tapered inner tip, drawn as four cubic Béziers. Pure: every value
 * arrives as an argument, and the output is an SVG path string.
 */

export type PetalShape = {
  /** Tip to outer end, in drawing units. */
  readonly length: number;
  /** Width across the bulb, in drawing units. */
  readonly width: number;
  /** Where the bulb is widest, as a fraction of the length from the tip. */
  readonly bulb: number;
  /**
   * How the sides leave the tip: 0 leaves square to the axis (a round tip),
   * 1 aims straight at the bulb's handle, the sharpest point whose outline
   * stays convex. The outline never bends inward (petal.test.ts checks it
   * over the brand sheet's ranges).
   */
  readonly tipSharpness: number;
};

type Point = readonly [x: number, y: number];

export type PetalPlacement = {
  /** The inner tip, the end nearest the bloom's centre. */
  readonly tip: Point;
  /** Degrees clockwise from pointing straight up. */
  readonly angle: number;
  readonly scale?: number;
};

/** Handle length that makes a cubic Bézier trace a quarter ellipse. */
const KAPPA = 0.5523;

/** How far back from the bulb its tangent handle reaches, as a fraction. */
const BULB_HANDLE = 0.25;

const assertDrawable = ({ length, width, bulb, tipSharpness }: PetalShape) => {
  if (!(length > 0)) throw new RangeError('petal length must be positive');
  if (!(width > 0)) throw new RangeError('petal width must be positive');
  if (!(bulb > 0 && bulb < 1))
    throw new RangeError('petal bulb must sit between 0 and 1');
  if (!(tipSharpness >= 0 && tipSharpness <= 1))
    throw new RangeError('petal tip sharpness must sit between 0 and 1');
};

/** Three decimals is well under a pixel at any size the mark is drawn. */
const format = (value: number): string => {
  const rounded = Number(value.toFixed(3));
  return String(Object.is(rounded, -0) ? 0 : rounded);
};

const formatPoint = ([x, y]: Point): string => `${format(x)} ${format(y)}`;

/**
 * The petal's outline. `u` runs along the axis from the tip outward and `v`
 * across it; placement rotates and scales that frame about the tip.
 */
export const petalPath = (
  shape: PetalShape,
  { tip, angle, scale = 1 }: PetalPlacement,
): string => {
  assertDrawable(shape);
  const radians = (angle * Math.PI) / 180;
  const along: Point = [Math.sin(radians), -Math.cos(radians)];
  const across: Point = [Math.cos(radians), Math.sin(radians)];
  const at = (u: number, v: number): string =>
    formatPoint([
      tip[0] + (u * along[0] + v * across[0]) * scale,
      tip[1] + (u * along[1] + v * across[1]) * scale,
    ]);

  const { length, width, bulb, tipSharpness } = shape;
  const half = width / 2;
  const widest = bulb * length;
  const cap = length - widest;
  const bulbHandle = widest * (1 - BULB_HANDLE);
  // The taper's control polygon (tip, tip handle, bulb handle, widest point)
  // stays convex, so the curve has no inflection: the tip handle aims no
  // lower than the bulb handle and reaches no higher than the bulb.
  const convexLimit = Math.atan2(half, bulbHandle);
  const tipAngle =
    convexLimit + (Math.PI / 2 - convexLimit) * (1 - tipSharpness);
  const tipReach = Math.min(Math.hypot(bulbHandle, half) / 2, half);
  const tipHandle = [
    tipReach * Math.cos(tipAngle),
    tipReach * Math.sin(tipAngle),
  ] as const;

  // Each side: tip → widest point (the taper), widest point → end (a quarter
  // ellipse, so the outer end is round).
  return [
    `M${at(0, 0)}`,
    `C${at(tipHandle[0], tipHandle[1])} ${at(bulbHandle, half)} ${at(widest, half)}`,
    `C${at(widest + KAPPA * cap, half)} ${at(length, KAPPA * half)} ${at(length, 0)}`,
    `C${at(length, -KAPPA * half)} ${at(widest + KAPPA * cap, -half)} ${at(widest, -half)}`,
    `C${at(bulbHandle, -half)} ${at(tipHandle[0], -tipHandle[1])} ${at(0, 0)}`,
    'Z',
  ].join(' ');
};

/** The rotation of each petal in a bloom, evenly spaced from upright. */
export const bloom = (count = 8): readonly number[] => {
  if (!(Number.isInteger(count) && count > 0))
    throw new RangeError('bloom count must be a positive whole number');
  return Array.from({ length: count }, (_, index) => (index * 360) / count);
};

export type BloomLayout = {
  readonly centre: number;
  /** Centre to each petal's inner tip. */
  readonly petalInset: number;
};

export type BloomPetal = {
  readonly d: string;
  /** Every other petal from upright: the forest N, E, S, W of the mark. */
  readonly cardinal: boolean;
};

/**
 * A bloom's petals: each tip on a ring `petalInset` from the centre, turned
 * outward, the whole bloom scaled about the centre. Every mark renderer (the
 * React marks, the server-rendered confirm pages) draws from this.
 */
export const bloomPetals = (
  shape: PetalShape,
  { centre, petalInset }: BloomLayout,
  scale = 1,
): readonly BloomPetal[] =>
  bloom().map((angle, index) => {
    const radians = (angle * Math.PI) / 180;
    const reach = petalInset * scale;
    return {
      d: petalPath(shape, {
        tip: [
          centre + Math.sin(radians) * reach,
          centre - Math.cos(radians) * reach,
        ],
        angle,
        scale,
      }),
      cardinal: index % 2 === 0,
    };
  });

export type OpposingLayout = {
  readonly centre: Point;
  /** Distance between the two tips. */
  readonly gap: number;
  /** Degrees each petal turns off the horizontal, in the same sense. */
  readonly tilt: number;
  readonly scale?: number;
};

/**
 * The debate's two sides: two petals tip to tip across the centre, each the
 * other turned half a circle. Returns `[left, right]`.
 */
export const opposingPetals = (
  shape: PetalShape,
  { centre, gap, tilt, scale = 1 }: OpposingLayout,
): readonly [left: string, right: string] => {
  const side = (angle: number): string => {
    const radians = (angle * Math.PI) / 180;
    const reach = gap / 2;
    return petalPath(shape, {
      tip: [
        centre[0] + Math.sin(radians) * reach,
        centre[1] - Math.cos(radians) * reach,
      ],
      angle,
      scale,
    });
  };
  return [side(270 + tilt), side(90 + tilt)];
};
