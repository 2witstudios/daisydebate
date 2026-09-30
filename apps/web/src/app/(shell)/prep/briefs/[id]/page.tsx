import type { Metadata } from 'next';
import type { SearchParams } from '../../../../../features/access/decision';
import {
  briefEditorView,
  parseBriefEditorQuery,
} from '../../../../../features/prep/brief-editor';
import {
  getBrief,
  speechLimitSeconds,
} from '../../../../../features/prep/get-brief';
import { readingPace } from '../../../../../features/prep/get-card';
import { requireAccess } from '../../../../../lib/access';
import { BriefEditor } from '../../../../../ui/prep/brief-editor/brief-editor';
import { NotFoundPanel } from '../../../../../ui/prep/not-found/not-found-panel';

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
  const brief = getBrief(id);
  if (brief === undefined)
    return (
      <NotFoundPanel
        what="brief"
        backHref="/prep?view=briefs"
        backLabel="Back to briefs"
      />
    );
  const query = parseBriefEditorQuery(await searchParams);
  return (
    <BriefEditor
      view={briefEditorView(brief, query, readingPace(), speechLimitSeconds())}
    />
  );
}
