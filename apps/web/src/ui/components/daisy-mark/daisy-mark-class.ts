/**
 * Fills per mark variant (ADR 0045). Cardinals are the N/E/S/W petals. The
 * primary petals follow the scheme: forest and sage on the cream page, cream
 * on the dark page.
 */
export const markFills = {
  primary: {
    cardinal: 'fill-mark-cardinal',
    diagonal: 'fill-mark-diagonal',
    disc: 'fill-yolk',
  },
  mono: {
    cardinal: 'fill-current',
    diagonal: 'fill-current',
    disc: 'fill-current',
  },
  reverse: {
    cardinal: 'fill-cream',
    diagonal: 'fill-cream',
    disc: 'fill-yolk',
  },
} as const;

export type DaisyMarkVariant = keyof typeof markFills;
