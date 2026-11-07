import { analysisRequestNotice } from '../../../../features/round-analysis/request-notice';
import { BoundedDocuments } from '../../../../ui/documents/bounded-documents';
import { documentPrincipalOf } from '../../../../features/documents/document-principal';
import {
  requestHostedAudienceLink,
  requestRoundRatings,
} from '../../../../lib/request-session';
import { RoundRatings } from '../../../../ui/ranked/round-ratings';
import { readPersistedBallot } from '../../judge/ballot/[roundId]/actions';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createAppError } from '@daisy/errors';
import { idSchema, type RoundView } from '@daisy/protocol';
import type { SearchParams } from '../../../../features/access/decision';
import { accessOrTemporary } from '../../../../lib/access';
import { isLiveDebater } from '../../../../ui/debate-room/live-round';
import { DocumentManager } from '../../../../ui/documents/document-manager';
import { reconnectingRoundPage } from '../../../../ui/debate-room/round-reconnecting';
import { RoundReceipt } from '../../../../ui/rooms/round-receipt/round-receipt';
import { RoundResult } from '../../../../ui/round-result/round-result';
import {
  ResultUnavailable,
  resultPart,
  resultRetryOf,
} from '../../../../ui/round-result/result-part';
import { drawReconnectDelaySeconds } from '../../../../ui/debate-room/reconnect-delay';
import { audienceLinkPageHref } from '../../../../features/audience-link/audience-link';
import { RoundAnalysis } from '../../../../ui/round-analysis/round-analysis';
import { isTemporaryRefusal } from '@daisy/db/capacity';
import { temporarilyRefused } from '../../../../server/temporary-read';
import { transcriptLines } from '../../../../ui/round-result/result-view';

import {
  readPersistedRound,
  readPersistedRoundAnalysis,
  reportRoundAction,
} from './actions';
import {
  reportAnswerText,
  reportNotice,
} from '../../../../features/content-moderation/submit-report';
import { ReportForm } from '../../../../ui/content-moderation/report-form';
import { readPersistedTranscript } from './read-persisted-transcript';
import { MediaDocument } from '../../../../ui/round-media/media-document';

export const metadata: Metadata = { title: 'Round' };
const nothing = { value: null, failure: null };
async function completedBallots(round: RoundView, member: boolean) {
  if (!member || round.status !== 'completed') return nothing;
  return resultPart(await readPersistedBallot(round.id), ({ view }) => view);
}
/**
 * Only a seated debater of a completed Round has a round analysis to read.
 * Its quotes come from the transcript read, never from the ballot read.
 */
async function ownAnalysis(round: RoundView, debater: boolean) {
  if (!debater || round.status !== 'completed')
    return [nothing, nothing] as const;
  const [result, transcript] = await Promise.all([
    readPersistedRoundAnalysis(round.id),
    readPersistedTranscript(round.id),
  ]);
  return [
    resultPart(result, ({ view }) => ({
      view,
      lines:
        transcript.kind === 'found' ? transcriptLines(transcript.value) : [],
    })),
    resultPart(transcript, () => null),
  ] as const;
}
export default async function RoundPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const access = await accessOrTemporary(`/rounds/${id}`, searchParams);
  if (access.kind === 'temporary') return reconnectingRoundPage();
  const { identity } = access;
  const reported = reportNotice((await searchParams).report);
  const reportFromRound = reportRoundAction.bind(null, id);
  if (!idSchema.safeParse(id).success) notFound();
  const result = await readPersistedRound(id);
  if (result.kind === 'missing') notFound();
  if (temporarilyRefused(result)) return reconnectingRoundPage();
  if (result.kind !== 'found') throw createAppError('INFRASTRUCTURE');
  if (
    identity.state === 'member' &&
    isLiveDebater(result.round, identity.principal.actorId)
  )
    redirect(`/rounds/${id}/room`);
  const filePrincipal = documentPrincipalOf(identity);
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
  const [ballots, [analysis, transcript]] = await Promise.all([
    completedBallots(result.round, identity.state === 'member'),
    ownAnalysis(result.round, debater),
  ]);
  // Ratings are this page's content: refused, they must not read as none.
  const ratings = await requestRoundRatings(result.round).catch(
    (error: unknown) => {
      if (isTemporaryRefusal(error)) return 'refused' as const;
      throw error;
    },
  );
  if (ratings === 'refused') return reconnectingRoundPage();
  const retry = resultRetryOf([ballots, analysis, transcript]);
  const hostedLink = await requestHostedAudienceLink(id, identity);
  return (
    <>
      <MediaDocument />
      <RoundReceipt round={result.round}>
        <RoundRatings view={ratings} />
        {retry ? (
          <ResultUnavailable
            retrySeconds={
              retry === 'refresh' ? drawReconnectDelaySeconds() : null
            }
          />
        ) : null}
        {ballots.value ? (
          <RoundResult view={ballots.value} reportAction={reportFromRound} />
        ) : null}
        {analysis.value ? (
          <RoundAnalysis
            roundId={id}
            notice={(await searchParams).analysis === analysisRequestNotice}
            view={analysis.value.view}
            lines={analysis.value.lines}
          />
        ) : null}
        {hostedLink ? (
          <Link href={audienceLinkPageHref(id)} className="text-sm underline">
            Share this Round by link
          </Link>
        ) : null}
        {identity.state === 'member' ? (
          <>
            {reported ? (
              <p role="status" className="text-sm text-ink-muted">
                {reportAnswerText(reported)}
              </p>
            ) : null}
            <ReportForm
              targetKind="round"
              targetId={result.round.id}
              label="Report this round"
              action={reportFromRound}
            />
          </>
        ) : null}
      </RoundReceipt>
      {ownsFiles && filePrincipal !== null ? (
        <BoundedDocuments>
          <DocumentManager principalId={filePrincipal.userId} />
        </BoundedDocuments>
      ) : null}
    </>
  );
}
