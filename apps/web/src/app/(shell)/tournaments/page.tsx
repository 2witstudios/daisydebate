import type { Metadata } from 'next';
import { TournamentsInfo } from '../../../ui/tournaments/tournaments-info/tournaments-info';
export const metadata: Metadata = {
  title: 'Tournaments',
  alternates: { canonical: '/tournaments' },
};
export default function TournamentsPage() {
  return <TournamentsInfo />;
}
