import type { Metadata } from 'next';
import type { SearchParams } from '../../../features/access/decision';
import { driveMatch } from '../../../features/ranked/drive-match';
import { parseRankedQuery } from '../../../features/ranked/ranked-query';
import { requireAccess } from '../../../lib/access';
import { Ranked } from '../../../ui/ranked/ranked';

export const metadata: Metadata = { title: 'Ranked' };

export default async function RankedPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/ranked', searchParams);
  return <Ranked screen={driveMatch(parseRankedQuery(await searchParams))} />;
}
