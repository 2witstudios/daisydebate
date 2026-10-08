import { systemClock } from '@daisy/clock';
import type { Metadata } from 'next';
import type { SearchParams } from '../../../features/access/decision';
import { parseLibraryQuery } from '../../../features/prep/library/library-query';
import { listLibrary } from '../../../features/prep/library/list-library';
import { requireAccess } from '../../../lib/access';
import { Library } from '../../../ui/prep/library/library';

export const metadata: Metadata = { title: 'Prep' };

export default async function PrepPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/prep', searchParams);
  const query = parseLibraryQuery(await searchParams);
  return (
    <Library listing={listLibrary(query, systemClock.now())} query={query} />
  );
}
