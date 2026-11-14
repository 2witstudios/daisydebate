import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { readTournamentRequest } from '../../../../../../features/tab/guardian';
import { requestSampleScene } from '../../../../../../features/tab/sample/request-scene';
import { TournamentRequest } from '../../../../../../ui/tab/guardian/tournament-request';

export const metadata: Metadata = { title: 'Allow a tournament' };

export default async function Page({
  params,
}: {
  readonly params: Promise<{ minor: string; slug: string }>;
}) {
  const { minor, slug } = await params;
  const request = readTournamentRequest(
    minor,
    slug,
    await requestSampleScene(),
  );
  if (request === null) notFound();
  return <TournamentRequest request={request} />;
}
