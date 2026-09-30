import { systemClock } from '@daisy/clock';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { SearchParams } from '../../../../../../../features/access/decision';
import { getEvent } from '../../../../../../../features/tournaments/get-event';
import {
  parseRoomState,
  roomFlow,
} from '../../../../../../../features/tournaments/room';
import { requireAccess } from '../../../../../../../lib/access';
import { RoomPage } from '../../../../../../../ui/tournaments/event/room-page';

type Props = {
  params: Promise<{ id: string; round: string }>;
  searchParams: Promise<SearchParams>;
};

export const metadata: Metadata = { title: 'Tournament room' };

export default async function TournamentRoomRoute({
  params,
  searchParams,
}: Props) {
  const { id, round } = await params;
  await requireAccess(`/tournaments/mine/${id}/room/${round}`, searchParams);
  const data = getEvent(id, systemClock.now());
  if (!data || data.pairing.roomSlug !== round) notFound();
  return (
    <RoomPage
      screen={roomFlow(data, parseRoomState(await searchParams))}
      tournament={data.tournament}
      startsAt={data.pairing.startsAt}
    />
  );
}
