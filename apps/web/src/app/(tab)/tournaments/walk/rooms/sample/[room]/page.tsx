import { walkHref } from '../../../../../../../features/tab/walk-href';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { SearchParams } from '../../../../../../../features/access/decision';
import { tabRoutes } from '../../../../../../../features/tab/routes';
import { readRoom } from '../../../../../../../features/tab/sample/read-room';
import { requestSampleScene } from '../../../../../../../features/tab/sample/request-scene';
import { requireAccess } from '../../../../../../../lib/access';
import { WaitingRoom } from '../../../../../../../ui/tab/waiting-room/waiting-room';

export const metadata: Metadata = { title: 'Room' };

/**
 * A Room on sample data. An event Room lives at `/rooms/[id]` like any other
 * Room; the sample ones sit beside that route, never inside it, so the live
 * Room page is untouched.
 */
export default async function Page({
  params,
  searchParams,
}: {
  readonly params: Promise<{ room: string }>;
  readonly searchParams: Promise<SearchParams>;
}) {
  const { room: roomId } = await params;
  // A Room needs an account, sample or not: the page rechecks it for itself.
  await requireAccess(walkHref(tabRoutes.room(roomId)), searchParams);
  const room = readRoom(roomId, await requestSampleScene());
  if (room === null) notFound();
  return <WaitingRoom room={room} />;
}
