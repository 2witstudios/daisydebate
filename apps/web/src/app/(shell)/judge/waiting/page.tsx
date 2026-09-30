import type { Metadata } from 'next';
import type { SearchParams } from '../../../../features/access/decision';
import { parseWaitingStep, waitingView } from '../../../../features/judge/flow';
import { getPoolStatus } from '../../../../features/judge/get-pool-status';
import { judgeRoutes } from '../../../../features/judge/routes';
import { requireAccess } from '../../../../lib/access';
import { WaitingPage } from '../../../../ui/judge/waiting-page/waiting-page';

export const metadata: Metadata = { title: 'Waiting for a debate' };

export default async function JudgeWaitingPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess(judgeRoutes.waiting, searchParams);
  const step = parseWaitingStep(await searchParams);
  return <WaitingPage view={waitingView(step, getPoolStatus())} />;
}
