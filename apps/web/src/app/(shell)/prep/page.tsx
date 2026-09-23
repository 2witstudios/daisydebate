import type { Metadata } from 'next';
import { RouteShell } from '../ui/route-shell';

export const metadata: Metadata = { title: 'Prep' };

export default function PrepPage() {
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
