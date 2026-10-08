import type { Metadata } from 'next';
import type { SearchParams } from '../../../../../../features/access/decision';
import {
  parseReviewQuery,
  reviewView,
} from '../../../../../../features/prep/briefs/brief-review';
import { getBrief } from '../../../../../../features/prep/briefs/get-brief';
import { getShare } from '../../../../../../features/prep/teams/get-team';
import { requireAccess } from '../../../../../../lib/access';
import { NotFoundPanel } from '../../../../../../ui/prep/not-found/not-found-panel';
import { ReviewPage } from '../../../../../../ui/prep/review-page/review-page';

export const metadata: Metadata = { title: 'Brief' };

export default async function BriefReviewRoute({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  await requireAccess(`/prep/briefs/${id}/review`, searchParams);
  const brief = getBrief(id);
  if (brief === undefined || id === 'new')
    return (
      <NotFoundPanel
        what="brief"
        backHref="/prep?view=briefs"
        backLabel="Back to briefs"
      />
    );
  const query = parseReviewQuery(await searchParams);
  return <ReviewPage view={reviewView(brief, getShare(id), query)} />;
}
