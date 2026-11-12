import {
  floorProps,
  liveFloorProps,
} from '../../../../(shell)/rounds/[id]/floor/floor-props';
import { documentPrincipalOf } from '../../../../../features/documents/document-principal';
import { shareLinkHref } from '../../../../../features/audience-link/audience-link';
import {
  requestHostedAudienceLink,
  requestRoundRatings,
} from '../../../../../lib/request-session';
import { RoundRatings } from '../../../../../ui/ranked/round-ratings';
import type { ReactNode } from 'react';
import {
  LiveTranscript,
  type TranscriptPlacement,
} from '../../../../../ui/round-result/live-transcript';
import { TranscriptSeedRecovery } from '../../../../../ui/round-result/transcript-seed-recovery';
import { readPersistedJudgeRound } from '../../../../(shell)/judge/ballot/[roundId]/actions';
import { LiveJudgeRoom } from '../../../../../ui/judging-room/live-judge-room';
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
import { postRoundCallOffered } from '../../../../../features/post-round-call/offered';
import type { SearchParams } from '../../../../../features/access/decision';
import { accessOrTemporary } from '../../../../../lib/access';
import {
  isCallDebater,
  isLiveDebater,
} from '../../../../../ui/debate-room/live-round';
import { LiveRoundRoom } from '../../../../../ui/debate-room/live-round-room';
import { temporarilyRefused } from '../../../../../server/temporary-read';
import { reconnectingRoundPage } from '../../../../../ui/debate-room/round-reconnecting';
import { SeatedSpectatorChat } from '../../../../(shell)/audience/seated-spectator-chat';
import { readPersistedRound } from '../../../../(shell)/rounds/[id]/actions';
import { readPersistedTranscript } from '../../../../(shell)/rounds/[id]/read-persisted-transcript';
import { MediaDocument } from '../../../../../ui/round-media/media-document';
import {
  spectatorKindOf,
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
  if (temporarilyRefused(assigned)) return reconnectingRoundPage();
  if (assigned.kind === 'unavailable') {
    throw createAppError('INFRASTRUCTURE');
  }
  const room = watchingRoomOf({
    judgeRound: assigned.kind === 'found' ? assigned.round : null,
    judgeOnCall:
      assigned.kind === 'found' &&
      postRoundCallOffered(assigned.round, Date.parse(systemClock.now())),
    spectatorKind: spectatorKindOf(round),
  });
  if (room.kind === 'receipt') redirect(`/rounds/${id}`);
  if (room.kind === 'spectator')
    return (
      <LiveSpectatorRoom
        view={round}
        spectatorKind={room.spectatorKind}
        floor={(await floorProps(id, actorId, socketUrl)) ?? undefined}
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
  if (access.kind === 'temporary') return reconnectingRoundPage();
  const { identity } = access;
  if (!idSchema.safeParse(id).success) notFound();
  const principal = documentPrincipalOf(identity);
  if (principal === null) redirect(`/rounds/${id}`);
  const { actorId, userId: principalId } = principal;
  // Independent reads; the transcript's own audience policy decides it.
  const [result, text] = await Promise.all([
    readPersistedRound(id),
    readPersistedTranscript(id),
  ]);
  if (result.kind === 'missing') notFound();
  if (temporarilyRefused(result)) return reconnectingRoundPage();
  if (result.kind !== 'found') throw createAppError('INFRASTRUCTURE');
  const transcriptIn = (placement: TranscriptPlacement) =>
    transcriptOf(id, text, result.socketUrl, placement);
  if (
    !isLiveDebater(result.round, actorId) &&
    // A debater on the post-round call keeps the room (ADR 0126).
    !isCallDebater(result.round, actorId, Date.parse(systemClock.now()))
  )
    return watchingRoom(
      id,
      result.round,
      actorId,
      result.socketUrl,
      transcriptIn('card'),
    );
  const here = `/rounds/${id}/room`;
  const shareHref = shareLinkHref(
    await requestHostedAudienceLink(id, identity),
    id,
  );
  return (
    <>
      <MediaDocument />
      <LiveRoundRoom
        floor={liveFloorProps(id, actorId, result.socketUrl)}
        attendanceSlot={
          <>
            {shareHref ? (
              <a
                href={shareHref}
                target="_blank"
                rel="noopener"
                className="text-sm underline"
              >
                Share this Round by link
              </a>
            ) : null}
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
              retrySeconds={drawReconnectDelaySeconds()}
            />
          </>
        }
        audienceSlot={<SeatedSpectatorChat roundId={id} actorId={actorId} />}
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
