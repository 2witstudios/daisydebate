import { walkHref } from '../../../../../../../../features/tab/walk-href';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { SearchParams } from '../../../../../../../../features/access/decision';
import { tabRoutes } from '../../../../../../../../features/tab/routes';
import { readJudgeBallot } from '../../../../../../../../features/tab/sample/read-ballot-definition';
import { requestSampleScene } from '../../../../../../../../features/tab/sample/request-scene';
import { requireAccess } from '../../../../../../../../lib/access';
import { JudgeBallot } from '../../../../../../../../ui/tab/judge-ballot/judge-ballot';
import { sampleSubmit } from '../../../../../../sample-submit';

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
  await requireAccess(walkHref(tabRoutes.ballot(roomId)), searchParams);
  const ballot = readJudgeBallot(roomId, await requestSampleScene());
  if (ballot === null) notFound();
  return (
    <JudgeBallot
      ballot={ballot}
      submit={sampleSubmit(tabRoutes.ballot(roomId))}
    />
  );
}
