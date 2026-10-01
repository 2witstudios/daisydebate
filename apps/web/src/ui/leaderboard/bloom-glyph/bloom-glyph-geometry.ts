import { bloomPetals, type Bloom } from '../../../features/leaderboard/bloom';

export type Petal = {
  readonly cx: number;
  readonly cy: number;
  readonly angle: number;
  readonly filled: boolean;
};

const CENTER = 14;
const REACH = 8.2;
const PETALS = 8;
/** Which petals fill first, so two fill opposite and four fill the cardinals. */
const FILL_ORDER: readonly number[] = [0, 4, 2, 6, 1, 5, 3, 7];

/**
 * The eight petals of the bloom glyph in a 28-unit box. The band says how
 * many are filled; a provisional debater has none, shown as a hollow ring.
 */
export function bloomPetalShapes(bloom: Bloom): readonly Petal[] {
  const filled = new Set(FILL_ORDER.slice(0, bloomPetals(bloom)));
  return Array.from({ length: PETALS }, (_, i) => {
    const angle = (i * 360) / PETALS;
    const radians = (angle * Math.PI) / 180;
    return {
      cx: Math.round((CENTER + REACH * Math.sin(radians)) * 100) / 100,
      cy: Math.round((CENTER - REACH * Math.cos(radians)) * 100) / 100,
      angle,
      filled: filled.has(i),
    };
  });
}
