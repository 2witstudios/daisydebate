import { systemClock } from '@daisy/clock';
import type { Metadata } from 'next';
import { getSearch } from '../../../features/search/get-search';
import { SearchPage } from '../../../ui/search/search-page/search-page';

export const metadata: Metadata = { title: 'Search' };

/** Public: finds people, debates, tournaments and rooms by name. */
export default async function Search({
  searchParams,
}: {
  readonly searchParams: Promise<
    Record<string, string | readonly string[] | undefined>
  >;
}) {
  const results = getSearch(await searchParams, systemClock.now());
  return <SearchPage {...results} />;
}
