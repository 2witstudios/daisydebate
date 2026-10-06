import { systemClock } from '@daisy/clock';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { SearchParams } from '../../../../../features/access/decision';
import { getDebateInfo } from '../../../../../features/debates/get-debate';
import { getBallotDebaters } from '../../../../../features/judge/get-ballots';
import {
  ballotView,
  parseBallotState,
} from '../../../../../features/judge/ballot';
import { requireAccess } from '../../../../../lib/access';
import { BallotPage } from '../../../../../ui/judge/ballot-page/ballot-page';
import { submitBallotAction } from './actions';

export const metadata: Metadata = { title: 'Your ballot' };

export default async function BallotRoute({
  params,
  searchParams,
}: {
  params: Promise<{ debateId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { debateId } = await params;
  await requireAccess(`/judge/ballot/${debateId}`, searchParams);
  const info = getDebateInfo(debateId, systemClock.now());
  if (info === null) notFound();
  return (
    <BallotPage
      view={ballotView(
        debateId,
        info.title,
        parseBallotState(await searchParams),
        getBallotDebaters(),
      )}
      action={submitBallotAction.bind(null, debateId)}
    />
  );
}
