import {
  destinationHref,
  destinations,
  destinationSlugs,
  type DestinationSlug,
} from '../../features/destinations/destinations';
import type { ActionTileProps } from './action-tile/action-tile';

type TileLook = Pick<ActionTileProps, 'note' | 'tilt'>;

/** How each destination's note looks. Only Play is emphasised. */
const tileLooks: Readonly<Record<DestinationSlug, TileLook>> = {
  lobby: { note: 'action', tilt: 'slight-left' },
  watch: { note: 'yellow', tilt: 'slight-right' },
  judge: { note: 'sage', tilt: 'left' },
  tournaments: { note: 'yellow', tilt: 'right' },
  seasons: { note: 'yellow', tilt: 'slight-right' },
  leaderboard: { note: 'sage', tilt: 'slight-left' },
  train: { note: 'yellow', tilt: 'right' },
  prep: { note: 'sage', tilt: 'left' },
};

/** The eight destinations, in display order. */
export const tiles: readonly ActionTileProps[] = destinationSlugs.map(
  (slug) => ({
    destination: slug,
    href: destinationHref(slug),
    title: destinations[slug].title,
    description: destinations[slug].tagline,
    ...tileLooks[slug],
  }),
);
