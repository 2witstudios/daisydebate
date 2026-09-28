import type { Metadata } from 'next';
import type { SearchParams } from '../../../features/access/decision';
import { requireAccess } from '../../../lib/access';
import { RouteShell } from '../../ui/route-shell';

export const metadata: Metadata = { title: 'Prep' };

export default async function PrepPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/prep', searchParams);
  return (
    <RouteShell
      title="Prep"
      lede="Briefs, cases, and evidence cards — your debate library."
      planned={[
        'Briefs: structured case files with contentions and framing',
        'Evidence cards with citation provenance and tags',
        'Cases: assembly, versions, and sharing across teams',
        'Search and filtering across the whole library',
      ]}
    />
  );
}
