import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { readCreateRoom } from '../../../../../../features/tab/league';
import { tabRoutes } from '../../../../../../features/tab/routes';
import { requestSampleScene } from '../../../../../../features/tab/sample/request-scene';
import { CreateRoom } from '../../../../../../ui/tab/league-lobby/create-room';
import { sampleSubmit } from '../../../../sample-submit';

export const metadata: Metadata = { title: 'New room' };

export default async function Page({
  params,
}: {
  readonly params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const room = readCreateRoom(slug, await requestSampleScene());
  if (room === null) notFound();
  return (
    <CreateRoom
      room={room}
      submit={sampleSubmit(tabRoutes.newLeagueRoom(slug))}
    />
  );
}
