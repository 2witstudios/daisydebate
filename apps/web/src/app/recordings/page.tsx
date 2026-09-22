import type { Metadata } from 'next';
import { requireAccess } from '../../lib/access';
import { RouteShell } from '../ui/route-shell';

export const metadata: Metadata = { title: 'Recordings' };

export default async function RecordingsPage() {
  await requireAccess('/recordings', 'participant');
  return (
    <RouteShell
      title="Recordings"
      lede="Debate recordings and replay metadata."
      planned={[
        'Recording catalog per debate',
        'Replay with phase timeline',
        'Retention and visibility policy',
      ]}
    />
  );
}
