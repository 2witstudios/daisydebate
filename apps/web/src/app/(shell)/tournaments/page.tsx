import type { Metadata } from 'next';
import { tabReleased } from '../../../features/tab/release';
import { requestSampleScene } from '../../../features/tab/sample/request-scene';
import {
  readTournamentsIndex,
  type IndexParams,
} from '../../../features/tab/tournaments-index';
import { TournamentsDirectory } from '../../../ui/tab/tournaments-directory/tournaments-directory';
import { TournamentsInfo } from '../../../ui/tournaments/tournaments-info/tournaments-info';

export const metadata: Metadata = {
  title: 'Tournaments',
  alternates: { canonical: '/tournaments' },
};

/**
 * Public: what Daisy plans for tournaments. With the Tab release open it is
 * the tournaments index instead, its search, filters, tab, calendar day and
 * page in the address.
 */
export default async function TournamentsPage({
  searchParams,
}: {
  readonly searchParams: Promise<IndexParams>;
}) {
  if (!(await tabReleased())) return <TournamentsInfo />;
  return (
    <TournamentsDirectory
      index={readTournamentsIndex(
        await requestSampleScene(),
        await searchParams,
      )}
    />
  );
}
