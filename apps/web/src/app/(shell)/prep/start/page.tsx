import type { Metadata } from 'next';
import type { SearchParams } from '../../../../features/access/decision';
import { requireAccess } from '../../../../lib/access';
import { FirstVisit } from '../../../../ui/prep/first-visit/first-visit';

export const metadata: Metadata = { title: 'Start your prep library' };

/** The getting-started page: what the library is and three ways to begin. */
export default async function PrepStartPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/prep/start', searchParams);
  return <FirstVisit />;
}
