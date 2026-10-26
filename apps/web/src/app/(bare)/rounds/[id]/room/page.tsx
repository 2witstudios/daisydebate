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
import { idSchema } from '@daisy/protocol';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import type { SearchParams } from '../../../../../features/access/decision';
import { requireAccess } from '../../../../../lib/access';
import { isLiveDebater } from '../../../../../ui/debate-room/live-round';
import { LiveRoundRoom } from '../../../../../ui/debate-room/live-round-room';
import { readPersistedRound } from '../../../../(shell)/rounds/[id]/actions';
import { MediaDocument } from '../../../../../ui/round-media/media-document';

export const metadata: Metadata = { title: 'Round' };

/** Fresh assigned members enter their own live view; everyone else gets the receipt. */
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
  const result = await readPersistedRound(id);
  if (result.kind === 'missing') notFound();
  if (result.kind !== 'found') throw createAppError('INFRASTRUCTURE');
  if (!isLiveDebater(result.round, actorId)) {
    const assigned = await readPersistedJudgeRound(id);
    if (assigned.kind === 'unavailable') throw createAppError('INFRASTRUCTURE');
    if (assigned.kind !== 'found') redirect(`/rounds/${id}`);
    if (!['active', 'scheduled'].includes(assigned.round.status))
      redirect(`/rounds/${id}`);
    return (
      <>
        <MediaDocument />
        <LiveJudgeRoom
          view={assigned.round}
          read={readPersistedJudgeRound.bind(null, id)}
          socketUrl={result.socketUrl}
        />
      </>
    );
  }
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
