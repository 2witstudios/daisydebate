import { requestRoundRatings } from '../../../../lib/request-session';
import { RoundRatings } from '../../../../ui/ranked/round-ratings';
import { readPersistedBallot } from '../../judge/ballot/[debateId]/actions';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { createAppError } from '@daisy/errors';
import { idSchema, type RoundView } from '@daisy/protocol';
import type { SearchParams } from '../../../../features/access/decision';
import { requireAccess } from '../../../../lib/access';
import { isLiveDebater } from '../../../../ui/debate-room/live-round';
import { RoundDocuments } from '../../../../ui/debate-room/round-documents';
import { RoundReceipt } from '../../../../ui/rooms/round-receipt/round-receipt';
import { RoundResult } from '../../../../ui/round-result/round-result';
import { RoundAnalysis } from '../../../../ui/round-analysis/round-analysis';
import { transcriptLines } from '../../../../ui/round-result/result-view';

import {
  readPersistedRound,
  readPersistedRoundAnalysis,
  readPersistedTranscript,
} from './actions';
import { MediaDocument } from '../../../../ui/round-media/media-document';

export const metadata: Metadata = { title: 'Round' };
async function completedBallots(round: RoundView, member: boolean) {
  if (!member || round.status !== 'completed') return null;
  const result = await readPersistedBallot(round.id);
  return result.kind === 'found' ? result.view : null;
}
/**
 * Only a seated debater of a completed Round has a round analysis to read.
 * Its quotes come from the transcript read, never from the ballot read.
 */
async function ownAnalysis(round: RoundView, debater: boolean) {
  if (!debater || round.status !== 'completed') return null;
  const [result, transcript] = await Promise.all([
    readPersistedRoundAnalysis(round.id),
    readPersistedTranscript(round.id),
  ]);
  if (result.kind !== 'found') return null;
  return {
    view: result.view,
    lines: transcript.kind === 'found' ? transcriptLines(transcript.value) : [],
  };
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
  const debater =
    identity.state === 'member' &&
    result.round.participants.some(
      (p) =>
        !('anonymous' in p) &&
        p.actorId === identity.principal.actorId &&
        p.role !== 'judge',
    );
  const [ballots, analysis] = await Promise.all([
    completedBallots(result.round, identity.state === 'member'),
    ownAnalysis(result.round, debater),
  ]);
  return (
    <>
      <MediaDocument />
      <RoundReceipt round={result.round}>
        <RoundRatings view={await requestRoundRatings(result.round)} />
        {ballots ? <RoundResult view={ballots} /> : null}
        {analysis ? (
          <RoundAnalysis view={analysis.view} lines={analysis.lines} />
        ) : null}
      </RoundReceipt>
      {ownsFiles ? (
        <RoundDocuments
          roundId={result.round.id}
          principalId={identity.principal.userId ?? 'anonymous'}
        />
      ) : null}
    </>
  );
}
