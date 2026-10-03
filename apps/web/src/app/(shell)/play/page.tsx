import type { Metadata } from 'next';
import type { SearchParams } from '../../../features/access/decision';
import { requireAccess } from '../../../lib/access';
import { CreateRoomPage } from '../../../ui/rooms/create-room/create-room-page';
import { createRoomAction } from './actions';

export const metadata: Metadata = { title: 'Open a practice room' };

export default async function PlayPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/play', searchParams);
  return <CreateRoomPage action={createRoomAction} />;
}
