import type { Metadata } from 'next';
import { tabReleased } from '../../../features/tab/release';
import { tabRoutes } from '../../../features/tab/routes';
import { requestSampleScene } from '../../../features/tab/sample/request-scene';
import { readTournaments } from '../../../features/tab/tournament';
import { TournamentsDirectory } from '../../../ui/tab/tournaments-directory/tournaments-directory';
import { TournamentsInfo } from '../../../ui/tournaments/tournaments-info/tournaments-info';

export const metadata: Metadata = {
  title: 'Tournaments',
  alternates: { canonical: '/tournaments' },
};

/**
 * Public: what Daisy plans for tournaments. With the Tab release open it is
 * the list of tournaments instead.
 */
export default async function TournamentsPage() {
  if (!(await tabReleased())) return <TournamentsInfo />;
  return (
    <TournamentsDirectory
      tournaments={readTournaments(await requestSampleScene())}
      league={{ name: 'Southeast League', href: tabRoutes.league('southeast') }}
    />
  );
}
