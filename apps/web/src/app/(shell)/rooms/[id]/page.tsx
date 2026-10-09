import { systemClock } from '@daisy/clock';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { SearchParams } from '../../../../features/access/decision';
import { getRoomInfo } from '../../../../features/rooms/get-room';
import { parseRoomState } from '../../../../features/rooms/state';
import { roomView } from '../../../../features/rooms/view';
import { requireAccess } from '../../../../lib/access';
import { RoomPage } from '../../../../ui/rooms/room-page/room-page';
import { RoomRefresher } from '../../../../ui/rooms/room-page/room-refresher';
import { saveRoomSettingsAction } from './actions';

export const metadata: Metadata = { title: 'Room' };

export default async function RoomRoute({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const query = await searchParams;
  await requireAccess(`/rooms/${id}`, searchParams);
  const info = getRoomInfo(id, systemClock.now());
  if (info === null) notFound();
  const search = new URLSearchParams(
    Object.entries(query).flatMap(([key, value]) =>
      typeof value === 'string' ? [[key, value] as [string, string]] : [],
    ),
  ).toString();
  return (
    <>
      <RoomRefresher />
      <RoomPage
        view={roomView(info, parseRoomState(id, query, info.judge))}
        settingsAction={saveRoomSettingsAction.bind(null, id, search)}
      />
    </>
  );
}
