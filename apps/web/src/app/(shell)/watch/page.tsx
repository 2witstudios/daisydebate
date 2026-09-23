import type { Metadata } from 'next';
import { RouteShell } from '../../ui/route-shell';

export const metadata: Metadata = { title: 'Watch' };

export default function WatchPage() {
  return (
    <RouteShell
      title="Watch"
      lede="Follow live debates as a spectator."
      planned={[
        'Watch consolidates live spectating and the recordings archive',
        'Spectator rooms with delayed state',
        'Live phase and clock display',
        'Reactions and moderated chat',
      ]}
    />
  );
}
