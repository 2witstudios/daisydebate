import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requestSampleScene } from '../../../../../../../../features/tab/sample/request-scene';
import { readTournamentPage } from '../../../../../../../../features/tab/tournament';
import { TournamentPage } from '../../../../../../../../ui/tab/tournament-page/tournament-page';

export const metadata: Metadata = { title: 'Round' };

export default async function Page({
  params,
}: {
  readonly params: Promise<{ slug: string; event: string; round: string }>;
}) {
  const route = await params;
  const page = readTournamentPage(
    route.slug,
    { kind: 'round', event: route.event, round: route.round },
    await requestSampleScene(),
  );
  if (page === null) notFound();
  return <TournamentPage page={page} />;
}
