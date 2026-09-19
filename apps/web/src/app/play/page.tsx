import type { Metadata } from 'next';
import { RouteShell } from '../ui/route-shell';

export const metadata: Metadata = { title: 'Play' };

export default function PlayPage() {
  return (
    <RouteShell
      title="Play"
      lede="Start a debate or join an open table."
      planned={[
        'Casual and ranked debate creation',
        'Format and resolution selection',
        'Readiness and clock configuration',
      ]}
    />
  );
}
