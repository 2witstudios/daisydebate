import type { Metadata } from 'next';
import { RouteShell } from '../ui/route-shell';

export const metadata: Metadata = { title: 'Debates' };

export default function DebatesPage() {
  return (
    <RouteShell
      title="Debates"
      lede="Your debate history and active matches."
      planned={[
        'Personal debate list with outcomes',
        'Ballot and result history',
        'Links to recordings and analysis',
      ]}
    />
  );
}
