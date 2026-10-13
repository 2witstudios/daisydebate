import { systemClock } from '@daisy/clock';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import type { SearchParams } from '../../../../../features/access/decision';
import { requireAccess } from '../../../../../lib/access';
import {
  debaterView,
  isLiveDebater,
} from '../../../../../ui/debate-room/live-round';
import { LiveRoundRoom } from '../../../../../ui/debate-room/live-round-room';
import { readPersistedRound } from '../../../../(shell)/rounds/[id]/actions';

export const metadata: Metadata = { title: 'Round' };

/** The debater's round room, outside the app shell; anyone else gets the receipt. */
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
  if (!isLiveDebater(result.round, actorId)) redirect(`/rounds/${id}`);
  const here = `/rounds/${id}/room`;
  return (
    <LiveRoundRoom
      view={debaterView(result.round)}
      actorId={actorId}
      renderedAtMs={Date.parse(systemClock.now())}
      leave={{
        confirming: 'leave' in (await searchParams),
        stayHref: here,
        confirmHref: `${here}?leave`,
        leaveHref: '/lobby',
      }}
    />
  );
}
