import type { Metadata } from 'next';
import { RouteShell } from '../ui/route-shell';

export const metadata: Metadata = { title: 'Judge' };

export default function JudgePage() {
  return (
    <RouteShell
      title="Judge"
      lede="Evaluate assigned debates and submit ballots."
      planned={[
        'Judge assignment and availability',
        'Structured ballot submission',
        'Ballot conflict and review policy',
      ]}
    />
  );
}
