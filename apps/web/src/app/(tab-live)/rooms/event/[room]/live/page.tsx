import { notFound, redirect } from 'next/navigation';
import type { SearchParams } from '../../../../../../features/access/decision';
import { tabRoutes } from '../../../../../../features/tab/routes';
import { roomWatchHref } from '../../../../../../features/watch/routes';
import { storedEventRoom } from '../../../../../(tab)/rooms/event/read-room';

export default async function Page({
  params,
  searchParams,
}: {
  readonly params: Promise<{ room: string }>;
  readonly searchParams: Promise<SearchParams>;
}) {
  const { room } = await params;
  const view = await storedEventRoom(
    room,
    tabRoutes.liveRoom(room),
    searchParams,
  );
  const destination =
    roomWatchHref(view.watch) ??
    (view.roundRef ? `/rounds/${view.roundRef.id}/room` : null);
  if (!destination) notFound();
  redirect(destination);
}
