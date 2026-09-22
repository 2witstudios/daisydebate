import type { Metadata } from 'next';
import { requireAccess } from '../../lib/access';
import { RouteShell } from '../ui/route-shell';

export const metadata: Metadata = { title: 'Judge' };

export default async function JudgePage() {
  await requireAccess('/judge', 'participant');
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
