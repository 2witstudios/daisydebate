import type { ReactNode } from 'react';
import { LiveTranscript } from '../../../../../ui/round-result/live-transcript';
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
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import type { SearchParams } from '../../../../../features/access/decision';
import { requireAccess } from '../../../../../lib/access';
import { isLiveDebater } from '../../../../../ui/debate-room/live-round';
import { LiveRoundRoom } from '../../../../../ui/debate-room/live-round-room';
import {
  readPersistedRound,
  readPersistedTranscript,
} from '../../../../(shell)/rounds/[id]/actions';
import { MediaDocument } from '../../../../../ui/round-media/media-document';
import { spectatorAudienceOf } from '../../../../../features/spectating/spectator-view';
import { LiveSpectatorRoom } from '../../../../../ui/spectating/live-spectator-room';

export const metadata: Metadata = { title: 'Round' };

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
  if (assigned.kind === 'unavailable') throw createAppError('INFRASTRUCTURE');
  if (assigned.kind !== 'found') {
    const audience = spectatorAudienceOf(round, actorId);
    if (audience === null) redirect(`/rounds/${id}`);
    return (
      <LiveSpectatorRoom
        view={round}
        audience={audience}
        transcript={transcript}
        renderedAtMs={Date.parse(systemClock.now())}
        read={readPersistedRound.bind(null, id)}
        socketUrl={socketUrl}
      />
    );
  }
  if (!['active', 'scheduled'].includes(assigned.round.status))
    redirect(`/rounds/${id}`);
  return (
    <>
      <MediaDocument />
      <LiveJudgeRoom
        view={assigned.round}
        transcript={transcript}
        read={readPersistedJudgeRound.bind(null, id)}
        socketUrl={socketUrl}
      />
    </>
  );
}

/**
 * Fresh assigned members enter their own live view, a seatless host watches
 * as a spectator, and everyone else gets the receipt.
 */
export default async function RoundRoomPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const identity = await requireAccess(`/rounds/${id}/room`, searchParams);
  if (!idSchema.safeParse(id).success) notFound();
  const actorId =
    identity.state === 'member' ? identity.principal.actorId : null;
  if (actorId === null) redirect(`/rounds/${id}`);
  // Independent reads; the transcript's own audience policy decides it.
  const [result, text] = await Promise.all([
    readPersistedRound(id),
    readPersistedTranscript(id),
  ]);
  if (result.kind === 'missing') notFound();
  if (result.kind !== 'found') throw createAppError('INFRASTRUCTURE');
  const transcript =
    text.kind === 'found' ? (
      <LiveTranscript
        seed={text.value}
        read={readPersistedTranscript.bind(null, id)}
        socketUrl={result.socketUrl}
      />
    ) : text.kind === 'unavailable' ? (
      // Refusals read as missing; only an outage, never a denial, says this.
      <p role="status">Transcript unavailable. Reload to try again.</p>
    ) : null;
  if (!isLiveDebater(result.round, actorId))
    return watchingRoom(
      id,
      result.round,
      actorId,
      result.socketUrl,
      transcript,
    );
  const here = `/rounds/${id}/room`;
  return (
    <>
      <MediaDocument />
      <LiveRoundRoom
        attendanceSlot={
          <RoundNativeAttendance
            view={result.round}
            state={await readPersistedAttendance(id)}
          />
        }
        transcript={transcript}
        commandAction={roundCommandAction.bind(null, id)}
        commandIds={roundCommandIds(() => systemId.next())}
        view={result.round}
        actorId={actorId}
        renderedAtMs={Date.parse(systemClock.now())}
        read={readPersistedRound.bind(null, id)}
        socketUrl={result.socketUrl}
        leave={{
          confirming: 'leave' in (await searchParams),
          stayHref: here,
          confirmHref: `${here}?leave`,
          leaveHref: '/lobby',
        }}
        leaveAction={leaveRoundAction.bind(null, id)}
      />
    </>
  );
}
