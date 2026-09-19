import type { Metadata } from 'next';
import { RouteShell } from '../ui/route-shell';

export const metadata: Metadata = { title: 'Lobby' };

export default function LobbyPage() {
  return (
    <RouteShell
      title="Lobby"
      lede="Open tables, queues, and direct challenges."
      planned={[
        'Presence-aware open tables',
        'Matchmaking queues per format',
        'Challenge acceptance with expiry',
      ]}
    />
  );
}
