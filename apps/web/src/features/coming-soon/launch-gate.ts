import { redirect } from 'next/navigation';
import type { DestinationSlug } from './destinations';
import { explainerHref, launched } from './launch';

/**
 * A closed destination's own routes answer with its explainer, so its flag
 * decides what a typed address reaches as well as what the nav lists.
 */
export const redirectUnlessLaunched = (
  slug: DestinationSlug,
  config: Readonly<Record<DestinationSlug, boolean>> = launched,
): void => {
  if (!config[slug]) redirect(explainerHref(slug));
};
