import type { Metadata } from 'next';
import { TournamentsInfo } from '../../../ui/tournaments/tournaments-info/tournaments-info';
import { tabReleased } from '../../tab-release';
export const metadata: Metadata = {
  title: 'Tournaments',
  alternates: { canonical: '/tournaments' },
};
/** Public: what Daisy plans for tournaments, its tabulation note following the Tab release. */
export default async function TournamentsPage() {
  return <TournamentsInfo tabReleased={await tabReleased()} />;
}
