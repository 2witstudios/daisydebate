import { roundDocumentPrincipal } from '../../../../features/debate-room/documents/document-principal';
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
import {
  ResultRetry,
  resultPart,
} from '../../../../ui/round-result/result-part';
import { reconnectDelaySeconds } from '../../../../ui/debate-room/reconnect-delay';
import { RoundAnalysis } from '../../../../ui/round-analysis/round-analysis';
import { transcriptLines } from '../../../../ui/round-result/result-view';

import { readPersistedRound, readPersistedRoundAnalysis } from './actions';
import { readPersistedTranscript } from './read-persisted-transcript';
import { MediaDocument } from '../../../../ui/round-media/media-document';

export const metadata: Metadata = { title: 'Round' };
async function completedBallots(round: RoundView, member: boolean) {
  if (!member || round.status !== 'completed')
    return { value: null, unavailable: false };
  return resultPart(await readPersistedBallot(round.id), ({ view }) => view);
}
/**
 * Only a seated debater of a completed Round has a round analysis to read.
 * Its quotes come from the transcript read, never from the ballot read.
 */
async function ownAnalysis(round: RoundView, debater: boolean) {
  if (!debater || round.status !== 'completed')
    return { value: null, unavailable: false };
  const [result, transcript] = await Promise.all([
    readPersistedRoundAnalysis(round.id),
    readPersistedTranscript(round.id),
  ]);
  const analysis = resultPart(result, ({ view }) => ({
    view,
    lines: transcript.kind === 'found' ? transcriptLines(transcript.value) : [],
  }));
  return {
    ...analysis,
    unavailable: analysis.unavailable || transcript.kind === 'unavailable',
  };
}
const resultRetry = () => {
  const [entropy] = crypto.getRandomValues(new Uint8Array(1));
  return <ResultRetry retrySeconds={reconnectDelaySeconds(entropy!)} />;
};
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
    isLiveDebater(result.round, identity.principal.actorId)
  )
    redirect(`/rounds/${id}/room`);
  const filePrincipal = roundDocumentPrincipal(identity);
  const ownsFiles =
    filePrincipal !== null &&
    result.round.participants.some(
      (p) => !('anonymous' in p) && p.actorId === filePrincipal.actorId,
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
        {ballots.unavailable || analysis.unavailable ? resultRetry() : null}
        {ballots.value ? <RoundResult view={ballots.value} /> : null}
        {analysis.value ? (
          <RoundAnalysis
            view={analysis.value.view}
            lines={analysis.value.lines}
          />
        ) : null}
      </RoundReceipt>
      {ownsFiles && filePrincipal !== null ? (
        <RoundDocuments
          roundId={result.round.id}
          principalId={filePrincipal.userId}
        />
      ) : null}
    </>
  );
}
