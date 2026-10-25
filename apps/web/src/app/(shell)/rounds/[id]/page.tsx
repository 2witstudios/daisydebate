import { readPersistedBallot } from '../../judge/ballot/[debateId]/actions';
import { RoundBallotResults } from '../../../../ui/ballot/round-ballot-results';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { createAppError } from '@daisy/errors';
import { idSchema, type RoundView } from '@daisy/protocol';
import type { SearchParams } from '../../../../features/access/decision';
import { requireAccess } from '../../../../lib/access';
import { isLiveDebater } from '../../../../ui/debate-room/live-round';
import { RoundDocuments } from '../../../../ui/debate-room/round-documents';
import { RoundReceipt } from '../../../../ui/rooms/round-receipt/round-receipt';

import { readPersistedRound } from './actions';
import { MediaDocument } from '../../../../ui/round-media/media-document';

export const metadata: Metadata = { title: 'Round' };
async function completedBallots(round: RoundView, member: boolean) {
  if (!member || round.status !== 'completed') return null;
  const result = await readPersistedBallot(round.id);
  return result.kind === 'found' ? result.view : null;
}
export default async function RoundPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const identity = await requireAccess(`/rounds/${id}`, searchParams);
  if (!idSchema.safeParse(id).success) notFound();
  const result = await readPersistedRound(id);
  if (result.kind === 'missing') notFound();
  if (result.kind !== 'found') throw createAppError('INFRASTRUCTURE');
  if (
    identity.state === 'member' &&
    identity.principal.actorId !== null &&
    isLiveDebater(result.round, identity.principal.actorId)
  )
    redirect(`/rounds/${id}/room`);
  const ownsFiles =
    identity.state === 'member' &&
    result.round.participants.some(
      (p) => !('anonymous' in p) && p.actorId === identity.principal.actorId,
    );
  const ballots = await completedBallots(
    result.round,
    identity.state === 'member',
  );
  return (
    <>
      <MediaDocument />
      <RoundReceipt round={result.round} />
      {ballots ? <RoundBallotResults view={ballots} /> : null}
      {ownsFiles ? <RoundDocuments roundId={result.round.id} /> : null}
    </>
  );
}
