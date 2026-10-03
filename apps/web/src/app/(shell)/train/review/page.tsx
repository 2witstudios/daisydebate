import type { Metadata } from 'next';
import type { SearchParams } from '../../../../features/access/decision';
import { getReviewQueue } from '../../../../features/train/get-review';
import { getTrainingSummary } from '../../../../features/train/get-summary';
import {
  parseReviewQuery,
  reviewView,
} from '../../../../features/train/review';
import { requireAccess } from '../../../../lib/access';
import { ReviewPage } from '../../../../ui/train/review/review-page';

export const metadata: Metadata = { title: 'Review' };

export default async function TrainReviewPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/train/review', searchParams);
  const summary = getTrainingSummary();
  const view = reviewView(
    getReviewQueue(summary),
    parseReviewQuery(await searchParams),
    { total: summary.saved.total, dueTomorrow: summary.saved.dueTomorrow },
  );
  return <ReviewPage view={view} />;
}
