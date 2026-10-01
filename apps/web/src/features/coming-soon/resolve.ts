import { findDestination, type Destination } from './destinations';
import { launched, liveHref } from './launch';
import type { DestinationSlug } from './destinations';

export type ExplainerResolution =
  | { readonly kind: 'not-found' }
  | { readonly kind: 'redirect'; readonly to: string }
  | { readonly kind: 'show'; readonly destination: Destination };

/**
 * What `/coming-soon/<segment>` does for an untrusted segment: unknown is a
 * 404, a launched destination redirects to its live route, the rest show.
 */
export const resolveExplainer = (
  segment: string,
  config: Readonly<Record<DestinationSlug, boolean>> = launched,
): ExplainerResolution => {
  const destination = findDestination(segment);
  if (destination === null) return { kind: 'not-found' };
  return config[destination.slug]
    ? { kind: 'redirect', to: liveHref(destination.slug) }
    : { kind: 'show', destination };
};
