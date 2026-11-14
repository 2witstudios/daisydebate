import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { SearchParams } from '../../../../../../features/access/decision';
import { requireAccess } from '../../../../../../lib/access';
import { readJudgeBallot } from '../../../../../../features/tab/ballot-definition';
import { tabRoutes } from '../../../../../../features/tab/routes';
import { requestSampleScene } from '../../../../../../features/tab/sample/request-scene';
import { JudgeBallot } from '../../../../../../ui/tab/judge-ballot/judge-ballot';
import { sampleSubmit } from '../../../../sample-submit';

export const metadata: Metadata = { title: 'Your ballot' };

export default async function Page({
  params,
  searchParams,
}: {
  readonly params: Promise<{ room: string }>;
  readonly searchParams: Promise<SearchParams>;
}) {
  const { room: roomId } = await params;
  // A Room needs an account, sample or not: the page rechecks it for itself.
  await requireAccess(tabRoutes.ballot(roomId), searchParams);
  const ballot = readJudgeBallot(roomId, await requestSampleScene());
  if (ballot === null) notFound();
  return (
    <JudgeBallot
      ballot={ballot}
      submit={sampleSubmit(tabRoutes.ballot(roomId))}
    />
  );
}
