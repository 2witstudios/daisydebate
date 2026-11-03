import { roundDocumentPrincipal } from '../../../../../features/debate-room/documents/document-principal';
import { requestRoundRatings } from '../../../../../lib/request-session';
import { RoundRatings } from '../../../../../ui/ranked/round-ratings';
import type { ReactNode } from 'react';
import {
  LiveTranscript,
  type TranscriptPlacement,
} from '../../../../../ui/round-result/live-transcript';
import { TranscriptSeedRecovery } from '../../../../../ui/round-result/transcript-seed-recovery';
import { readPersistedJudgeRound } from '../../../../(shell)/judge/ballot/[debateId]/actions';
import { LiveJudgeRoom } from '../../../../../ui/debate-room/live-judge-room';
import {
  leaveRoundAction,
  roundCommandAction,
  readPersistedAttendance,
} from './actions';
import { RoundNativeAttendance } from '../../../../../features/attendance/native-state';
import { roundCommandIds } from '../../../../../features/round-runtime/command-ids';
import { systemClock, systemId } from '@daisy/clock';
import { createAppError } from '@daisy/errors';
import { idSchema, type RoundView } from '@daisy/protocol';
import { ratingsUnlessRefused } from '../../../../../features/ratings/ratings-unless-refused';
import { drawReconnectDelaySeconds } from '../../../../../ui/debate-room/reconnect-delay';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import type { SearchParams } from '../../../../../features/access/decision';
import { accessOrTemporary } from '../../../../../lib/access';
import { isLiveDebater } from '../../../../../ui/debate-room/live-round';
import { LiveRoundRoom } from '../../../../../ui/debate-room/live-round-room';
import { RoundRoomReconnecting } from '../../../../../ui/debate-room/round-room-reconnecting';
import { readPersistedRound } from '../../../../(shell)/rounds/[id]/actions';
import { readPersistedTranscript } from '../../../../(shell)/rounds/[id]/read-persisted-transcript';
import { MediaDocument } from '../../../../../ui/round-media/media-document';
import {
  spectatorAudienceOf,
  watchingRoomOf,
} from '../../../../../features/spectating/spectator-view';
import { LiveSpectatorRoom } from '../../../../../ui/spectating/live-spectator-room';

export const metadata: Metadata = { title: 'Round' };

const transcriptOf = (
  id: string,
  text: Awaited<ReturnType<typeof readPersistedTranscript>>,
  socketUrl: string | null,
  placement: TranscriptPlacement,
) =>
  text.kind === 'found' ? (
    <LiveTranscript
      key={id}
      seed={text.value}
      socketUrl={socketUrl}
      placement={placement}
    />
  ) : text.kind === 'unavailable' ? (
    // Refusals read as missing; only an outage, never a denial, says this.
    <TranscriptSeedRecovery
      key={id}
      roundId={id}
      socketUrl={socketUrl}
      placement={placement}
    />
  ) : null;

const reconnecting = () => (
  <RoundRoomReconnecting retrySeconds={drawReconnectDelaySeconds()} />
);

/**
 * A member without a seat: the assigned judge's live view, a seatless
 * host's spectator view, or the receipt for everyone else.
 */
async function watchingRoom(
  id: string,
  round: RoundView,
  actorId: string,
  socketUrl: string | null,
  transcript: ReactNode,
) {
  const assigned = await readPersistedJudgeRound(id);
  if (assigned.kind === 'unavailable') {
    if (assigned.temporary) return reconnecting();
    throw createAppError('INFRASTRUCTURE');
  }
  const room = watchingRoomOf({
    judgeRound: assigned.kind === 'found' ? assigned.round : null,
    audience: spectatorAudienceOf(round, actorId),
  });
  if (room.kind === 'receipt') redirect(`/rounds/${id}`);
  if (room.kind === 'spectator')
    return (
      <LiveSpectatorRoom
        view={round}
        audience={room.audience}
        transcript={transcript}
        renderedAtMs={Date.parse(systemClock.now())}
        read={readPersistedRound.bind(null, id)}
        socketUrl={socketUrl}
      />
    );
  return (
    <>
      <MediaDocument />
      <LiveJudgeRoom
        actorId={actorId}
        view={room.round}
        renderedAtMs={Date.parse(systemClock.now())}
        transcript={transcript}
        read={readPersistedJudgeRound.bind(null, id)}
        socketUrl={socketUrl}
      />
    </>
  );
}

/**
 * Fresh assigned members enter their own live view, a seatless host watches
 * as a spectator, and everyone else gets the receipt. A temporarily refused
 * read never costs a speaker the room (ISSUE-927): the Round keeps running, so
 * the page recovers by itself instead of waiting on the error boundary.
 */
export default async function RoundRoomPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const access = await accessOrTemporary(`/rounds/${id}/room`, searchParams);
  if (access.kind === 'temporary') return reconnecting();
  const { identity } = access;
  if (!idSchema.safeParse(id).success) notFound();
  const principal = roundDocumentPrincipal(identity);
  if (principal === null) redirect(`/rounds/${id}`);
  const { actorId, userId: principalId } = principal;
  // Independent reads; the transcript's own audience policy decides it.
  const [result, text] = await Promise.all([
    readPersistedRound(id),
    readPersistedTranscript(id),
  ]);
  if (result.kind === 'missing') notFound();
  if (result.kind === 'unavailable' && result.temporary) return reconnecting();
  if (result.kind !== 'found') throw createAppError('INFRASTRUCTURE');
  const transcriptIn = (placement: TranscriptPlacement) =>
    transcriptOf(id, text, result.socketUrl, placement);
  if (!isLiveDebater(result.round, actorId))
    return watchingRoom(
      id,
      result.round,
      actorId,
      result.socketUrl,
      transcriptIn('card'),
    );
  const here = `/rounds/${id}/room`;
  return (
    <>
      <MediaDocument />
      <LiveRoundRoom
        attendanceSlot={
          <>
            <RoundRatings
              view={await ratingsUnlessRefused(() =>
                requestRoundRatings(result.round),
              )}
            />
            <RoundNativeAttendance
              view={result.round}
              read={
                result.round.status === 'active'
                  ? await readPersistedAttendance(id)
                  : null
              }
              retrySeconds={reconnectDelaySeconds(
                crypto.getRandomValues(new Uint8Array(1))[0]!,
              )}
            />
          </>
        }
        transcript={transcriptIn('sidebar')}
        commandAction={roundCommandAction.bind(null, id)}
        commandIds={roundCommandIds(() => systemId.next())}
        view={result.round}
        actorId={actorId}
        principalId={principalId}
        renderedAtMs={Date.parse(systemClock.now())}
        read={readPersistedRound.bind(null, id)}
        socketUrl={result.socketUrl}
        leave={{
          confirming: 'leave' in (await searchParams),
          stayHref: here,
          confirmHref: `${here}?leave`,
          leaveHref: '/lobby',
          left: { actorId, roundId: id, roomId: result.round.roomId },
        }}
        leaveAction={leaveRoundAction.bind(null, id)}
      />
    </>
  );
}
