import { notFound, redirect } from 'next/navigation';
import type { SearchParams } from '../../../../../../features/access/decision';
import { tabRoutes } from '../../../../../../features/tab/routes';
import { storedEventRoom } from '../../read-room';

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
    tabRoutes.ballot(room),
    searchParams,
  );
  if (!view.roundRef) notFound();
  redirect(`/judge/ballot/${view.roundRef.id}`);
}
