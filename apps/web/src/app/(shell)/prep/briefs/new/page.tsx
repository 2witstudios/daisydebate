import type { Metadata } from 'next';
import type { SearchParams } from '../../../../../features/access/decision';
import { systemClock } from '@daisy/clock';
import { briefEditorView } from '../../../../../features/prep/briefs/brief-editor';
import { listBriefEvidence } from '../../../../../features/prep/briefs/brief-evidence';
import {
  getBrief,
  NEW_BRIEF_ID,
  speechLimitSeconds,
} from '../../../../../features/prep/briefs/get-brief';
import { readingPace } from '../../../../../features/prep/cards/get-card';
import { requireAccess } from '../../../../../lib/access';
import { BriefEditor } from '../../../../../ui/prep/brief-editor/brief-editor';

export const metadata: Metadata = { title: 'New brief' };

/** A blank brief: the editor over nothing written yet. */
export default async function NewBriefPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/prep/briefs/new', searchParams);
  const brief = getBrief(NEW_BRIEF_ID);
  if (brief === undefined) throw new Error('the blank brief is missing');
  return (
    <BriefEditor
      view={briefEditorView(
        brief,
        listBriefEvidence(systemClock.now()),
        readingPace(),
        speechLimitSeconds(),
      )}
    />
  );
}
