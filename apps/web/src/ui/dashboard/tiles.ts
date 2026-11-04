import {
  destinationHref,
  destinations,
  destinationSlugs,
  type DestinationSlug,
} from '../../features/destinations/destinations';
import type { ActionTileProps } from './action-tile/action-tile';

type TileLook = Pick<ActionTileProps, 'glyph' | 'note' | 'tilt'>;

/** How each destination's note looks. Only Play is emphasised. */
const tileLooks: Readonly<Record<DestinationSlug, TileLook>> = {
  lobby: { glyph: 'swords', note: 'action', tilt: 'slight-left' },
  watch: { glyph: 'eye', note: 'yellow', tilt: 'slight-right' },
  judge: { glyph: 'gavel', note: 'sage', tilt: 'left' },
  tournaments: { glyph: 'trophy', note: 'yellow', tilt: 'right' },
  seasons: { glyph: 'calendar', note: 'yellow', tilt: 'slight-right' },
  leaderboard: { glyph: 'chart', note: 'sage', tilt: 'slight-left' },
  train: { glyph: 'brain', note: 'yellow', tilt: 'right' },
  prep: { glyph: 'book', note: 'sage', tilt: 'left' },
};

/** The eight destinations, in display order. */
export const tiles: readonly ActionTileProps[] = destinationSlugs.map(
  (slug) => ({
    href: destinationHref(slug),
    title: destinations[slug].title,
    description: destinations[slug].tagline,
    ...tileLooks[slug],
  }),
);
