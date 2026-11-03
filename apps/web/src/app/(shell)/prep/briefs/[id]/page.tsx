import type { Metadata } from 'next';
import type { SearchParams } from '../../../../../features/access/decision';
import { systemClock } from '@daisy/clock';
import { briefEditorView } from '../../../../../features/prep/briefs/brief-editor';
import { listBriefEvidence } from '../../../../../features/prep/briefs/brief-evidence';
import { getBrief } from '../../../../../features/prep/briefs/get-brief';
import { requireAccess } from '../../../../../lib/access';
import { BriefEditor } from '../../../../../ui/prep/brief-editor/brief-editor';
import { NotFoundPanel } from '../../../../../ui/prep/not-found/not-found-panel';
import { samplePrepSource } from '../../../../../ui/mock/prep-source';

export const metadata: Metadata = { title: 'Brief' };

export default async function BriefPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  await requireAccess(`/prep/briefs/${id}`, searchParams);
  const brief = getBrief(samplePrepSource, id);
  if (brief === undefined)
    return (
      <NotFoundPanel
        what="brief"
        backHref="/prep?view=briefs"
        backLabel="Back to briefs"
      />
    );
  return (
    <BriefEditor
      view={briefEditorView(
        brief,
        listBriefEvidence(samplePrepSource, systemClock.now()),
        samplePrepSource.readingPace,
        samplePrepSource.speechLimitSeconds,
      )}
    />
  );
}
