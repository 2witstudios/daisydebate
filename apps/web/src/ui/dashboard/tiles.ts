import {
  destinations,
  destinationSlugs,
  type DestinationSlug,
} from '../../features/coming-soon/destinations';
import { launched, tileHref } from '../../features/coming-soon/launch';
import { destinationGlyph } from '../coming-soon/destination-glyph';
import type { ActionTileProps } from './action-tile/action-tile';

type TileConfig = ActionTileProps;

/**
 * The status line of a launched destination. It says only that the
 * destination is open: live counts come back when a real data source exists,
 * never as sample numbers.
 */
const launchedStatus = { tone: 'online', text: 'Open' } as const;

/** One tile per destination, from the launch config and the explainer copy. */
export const tileFor = (
  slug: DestinationSlug,
  config: Readonly<Record<DestinationSlug, boolean>> = launched,
): TileConfig => ({
  href: tileHref(slug, config),
  title: destinations[slug].title,
  description: destinations[slug].tagline,
  ...destinationGlyph[slug],
  ...(config[slug] ? { status: launchedStatus } : { comingSoon: true }),
});

/** The eight destinations, in display order. */
export const tiles: readonly TileConfig[] = destinationSlugs.map((slug) =>
  tileFor(slug),
);
