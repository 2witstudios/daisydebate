import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { SearchParams } from '../../../features/access/decision';
import { trainDestinations } from '../../../features/train/actions';
import { getTrainingSummary } from '../../../features/train/get-summary';
import { hubView } from '../../../features/train/hub';
import { parseHubQuery } from '../../../features/train/query';
import { isFirstVisit } from '../../../features/train/summary';
import { requireAccess } from '../../../lib/access';
import { TrainHub } from '../../../ui/train/hub/hub';

export const metadata: Metadata = { title: 'Train' };

export default async function TrainPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/train', searchParams);
  const summary = getTrainingSummary();
  if (isFirstVisit(summary)) redirect(trainDestinations.welcome);
  const query = parseHubQuery(await searchParams);
  return (
    <TrainHub view={hubView(summary, query)} summary={summary} query={query} />
  );
}
