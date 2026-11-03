import type { Metadata } from 'next';

/** Whether search engines may index this deployment. Closed unless configured. */
export type SearchIndexing = 'open' | 'closed';

/**
 * Noindex, not a robots.txt that disallows: a crawler refused the page never
 * reads the refusal, and can still list a URL it found elsewhere.
 */
export const robotsHeaderOf = (indexing: SearchIndexing): string | null =>
  indexing === 'closed' ? 'noindex, nofollow' : null;

export const robotsMetadataOf = (
  indexing: SearchIndexing,
): Metadata['robots'] | undefined =>
  indexing === 'closed' ? { index: false, follow: false } : undefined;
