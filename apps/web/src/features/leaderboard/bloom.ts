/**
 * Bloom bands are a display rule derived from a rating, never stored (ADR
 * 0029 item 5). The floors are sample thresholds until the owner sets them.
 */
const floors = [
  ['full-bloom', 1700],
  ['bloom', 1500],
  ['bud', 1300],
] as const;

export type BloomBand = 'sprout' | 'bud' | 'bloom' | 'full-bloom';
/** What a row shows beside the rating: a band, or unranked. */
export type Bloom = BloomBand | 'provisional';

export const bloomBands: readonly BloomBand[] = [
  'sprout',
  'bud',
  'bloom',
  'full-bloom',
];

export const bloomBand = (rating: number): BloomBand =>
  floors.find(([, floor]) => rating >= floor)?.[0] ?? 'sprout';

const labels: Readonly<Record<Bloom, string>> = {
  sprout: 'Sprout',
  bud: 'Bud',
  bloom: 'Bloom',
  'full-bloom': 'Full bloom',
  provisional: 'Provisional',
};

export const bloomLabel = (bloom: Bloom): string => labels[bloom];

const petals: Readonly<Record<Bloom, number>> = {
  sprout: 2,
  bud: 4,
  bloom: 6,
  'full-bloom': 8,
  provisional: 0,
};

/** How many of the glyph's eight petals are filled. */
export const bloomPetals = (bloom: Bloom): number => petals[bloom];
