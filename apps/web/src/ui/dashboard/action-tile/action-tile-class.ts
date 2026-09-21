export type ActionTileTint = 'accent' | 'gold' | 'neutral';

const tints: Readonly<Record<ActionTileTint, string>> = {
  accent: 'text-accent',
  gold: 'text-gold',
  neutral: 'text-glyph',
};

/** Icon color for an action tile tint. */
export const actionTileTintClass = (tint: ActionTileTint): string =>
  tints[tint];
