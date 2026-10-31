/**
 * Art direction registry for photographic surfaces. Each entry is a role in
 * the product (not a decorative asset): swap the path to replace the art.
 * Temporary photography is sourced under the Unsplash license.
 */
export type ArtKey = 'heroAgon' | 'earthNight' | 'quoteRidge' | 'laurelArena';

export const art: Record<
  ArtKey,
  {
    readonly src: string;
    readonly alt: string;
    /** Intrinsic pixel size: the image stays in flow before CSS applies. */
    readonly width: number;
    readonly height: number;
  }
> = {
  heroAgon: {
    src: '/images/hero-agon.webp',
    alt: 'Two figures in ancient Greek dress locked in an arm wrestle, with the Acropolis behind them',
    width: 1925,
    height: 817,
  },
  earthNight: {
    src: '/images/earth-night.jpg',
    alt: 'Earth at night seen from orbit, city lights glowing',
    width: 1600,
    height: 1065,
  },
  quoteRidge: {
    src: '/images/hero-ridge.jpg',
    alt: 'A green mountain ridge under fog',
    width: 2200,
    height: 1311,
  },
  laurelArena: {
    src: '/images/laurel-arena.png',
    alt: 'An ancient laurel trophy arena',
    width: 1774,
    height: 887,
  },
};

/**
 * Mock roster portraits keyed by display name; the future wiring swap point
 * replaces this lookup with profile data.
 */
const roster: Record<string, string> = {
  'Alex Chen': '/images/avatars/alex.jpg',
  'Maya Singh': '/images/avatars/maya.jpg',
  'Daniel Kim': '/images/avatars/daniel.jpg',
  'Sophia Lee': '/images/avatars/sophia.jpg',
  'Marcus Bell': '/images/avatars/marcus.jpg',
  'Priya Shah': '/images/avatars/priya.jpg',
};

export const avatarSrc = (name: string): string | undefined => roster[name];
