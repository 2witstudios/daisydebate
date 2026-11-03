import { systemClock } from '@daisy/clock';
import type { Metadata } from 'next';
import type { SearchParams } from '../../../../../features/access/decision';
import { parseCaseQuery } from '../../../../../features/prep/cases/case-query';
import { caseView } from '../../../../../features/prep/cases/case-view';
import { getCase } from '../../../../../features/prep/cases/get-case';
import { requireAccess } from '../../../../../lib/access';
import { CasePage } from '../../../../../ui/prep/case-page/case-page';
import { NotFoundPanel } from '../../../../../ui/prep/not-found/not-found-panel';
import { samplePrepSource } from '../../../../../ui/mock/prep-source';

export const metadata: Metadata = { title: 'Case' };

export default async function CaseRoute({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  await requireAccess(`/prep/cases/${id}`, searchParams);
  const found = getCase(samplePrepSource, id);
  if (found === undefined)
    return (
      <NotFoundPanel
        what="case"
        backHref="/prep?view=cases"
        backLabel="Back to cases"
      />
    );
  const query = parseCaseQuery(await searchParams);
  return (
    <CasePage
      view={caseView(
        samplePrepSource,
        found,
        query,
        samplePrepSource.readingPace,
        samplePrepSource.speechLimitSeconds,
        systemClock.now(),
      )}
    />
  );
}
