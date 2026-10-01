import type { DestinationSlug } from '../../features/coming-soon/destinations';
import type { IconName } from '../components/icon/icon';
import type { ActionTileTint } from '../dashboard/action-tile/action-tile-class';

/** The icon and tint each destination wears on its tile and its explainer. */
export const destinationGlyph: Readonly<
  Record<
    DestinationSlug,
    { readonly glyph: IconName; readonly tint: ActionTileTint }
  >
> = {
  ranked: { glyph: 'swords', tint: 'accent' },
  lobby: { glyph: 'users', tint: 'neutral' },
  watch: { glyph: 'eye', tint: 'neutral' },
  judge: { glyph: 'gavel', tint: 'gold' },
  tournaments: { glyph: 'trophy', tint: 'gold' },
  leaderboard: { glyph: 'chart', tint: 'neutral' },
  train: { glyph: 'bolt', tint: 'neutral' },
  prep: { glyph: 'book', tint: 'neutral' },
};
