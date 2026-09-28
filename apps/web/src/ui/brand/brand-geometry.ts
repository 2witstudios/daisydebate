import type { PetalShape } from './petal';

/**
 * Every tunable number in the Daisy brand geometry (ADR 0045). Each brand
 * renderer reads these, so this module is what ships; the /foundation brand
 * sheet previews other values but never changes these.
 */

/** The petal primitive, in the mark's 24-unit drawing. */
export const petalShape: PetalShape = {
  length: 8.4,
  width: 4.1,
  bulb: 0.58,
  tipSharpness: 0.2,
};

/** The bloom in a 24 × 24 drawing, centred. */
export const markGeometry = {
  size: 24,
  centre: 12,
  discRadius: 2.6,
  /**
   * Centre to each petal's inner tip; past the disc, so a ring of the
   * surface shows between the disc and the petals' rounded inner ends.
   */
  petalInset: 2.7,
} as const;

/** The favicon tile: a rounded square holding a smaller reverse bloom. */
export const tileGeometry = {
  cornerRadius: 5.5,
  bloomScale: 0.8,
} as const;

/** The two-sided petal pair, in a 48 × 24 drawing. */
export const opposingGeometry = {
  width: 48,
  height: 24,
  gap: 1,
  /** Both petals turn by this much, which keeps the pair point-symmetric. */
  tilt: -15,
  scale: 2.3,
} as const;
