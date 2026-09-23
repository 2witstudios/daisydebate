import type { Metadata } from 'next';
import { RouteShell } from '../../ui/route-shell';

export const metadata: Metadata = { title: 'Tournaments' };

export default function TournamentsPage() {
  return (
    <RouteShell
      title="Tournaments"
      lede="Organized bracket and round-robin events."
      planned={[
        'Tournament creation and registration',
        'Pairings and advancement',
        'Organizer and moderator tooling',
      ]}
    />
  );
}
