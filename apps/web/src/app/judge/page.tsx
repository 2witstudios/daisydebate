import type { Metadata } from 'next';
import type { SearchParams } from '../../features/access/decision';
import { requireAccess } from '../../lib/access';
import { RouteShell } from '../ui/route-shell';

export const metadata: Metadata = { title: 'Judge' };

export default async function JudgePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/judge', 'participant', searchParams);
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
