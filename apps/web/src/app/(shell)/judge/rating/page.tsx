import type { Metadata } from 'next';
import type { SearchParams } from '../../../../features/access/decision';
import { getJudgeRating } from '../../../../features/judge/get-judge-rating';
import { judgeRoutes } from '../../../../features/judge/routes';
import { requireAccess } from '../../../../lib/access';
import { RatingPage } from '../../../../ui/judge/rating-page/rating-page';

export const metadata: Metadata = { title: 'Your judge rating' };

export default async function JudgeRatingPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess(judgeRoutes.rating, searchParams);
  return <RatingPage rating={getJudgeRating()} />;
}
