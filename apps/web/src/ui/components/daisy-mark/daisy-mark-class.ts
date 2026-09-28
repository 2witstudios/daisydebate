/** Fills per mark variant (ADR 0045). Cardinals are the N/E/S/W petals. */
export const markFills = {
  primary: {
    cardinal: 'fill-forest',
    diagonal: 'fill-sage',
    disc: 'fill-butter',
  },
  mono: {
    cardinal: 'fill-current',
    diagonal: 'fill-current',
    disc: 'fill-current',
  },
  reverse: {
    cardinal: 'fill-cream',
    diagonal: 'fill-cream',
    disc: 'fill-butter',
  },
} as const;

export type DaisyMarkVariant = keyof typeof markFills;
