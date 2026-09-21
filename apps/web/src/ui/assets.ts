/**
 * Art direction registry for photographic surfaces. Each entry is a role in
 * the product (not a decorative asset): swap the path to replace the art.
 * Temporary photography is sourced under the Unsplash license.
 */
export type ArtKey = 'heroRidge' | 'earthNight' | 'quoteRidge';

export const art: Record<
  ArtKey,
  { readonly src: string; readonly alt: string }
> = {
  heroRidge: {
    src: '/images/hero-ridge.jpg',
    alt: 'A green mountain ridge at dawn with rolling fog',
  },
  earthNight: {
    src: '/images/earth-night.jpg',
    alt: 'Earth at night seen from orbit, city lights glowing',
  },
  quoteRidge: {
    src: '/images/hero-ridge.jpg',
    alt: 'A green mountain ridge under fog',
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
