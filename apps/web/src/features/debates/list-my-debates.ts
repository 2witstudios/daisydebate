import { sampleMyDebates } from '../../ui/mock/my-debates';
import { listing, type DebatesListing, type DebatesQuery } from './list';

/**
 * The My debates page's one data seam: the signed-in account's finished
 * debates for a query at `now`. Today it reads the sample history; the
 * backend read of the account's debates replaces this function and nothing
 * else.
 */
export function listMyDebates(
  query: DebatesQuery,
  now: string,
): DebatesListing {
  return listing(sampleMyDebates(now), query);
}
