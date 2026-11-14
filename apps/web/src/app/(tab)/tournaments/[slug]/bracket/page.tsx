import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requestSampleScene } from '../../../../../features/tab/sample/request-scene';
import { readTournamentPage } from '../../../../../features/tab/tournament';
import { TournamentPage } from '../../../../../ui/tab/tournament-page/tournament-page';

export const metadata: Metadata = { title: 'Bracket' };

export default async function Page({
  params,
  searchParams,
}: {
  readonly params: Promise<{ slug: string }>;
  readonly searchParams: Promise<{ event?: string | string[] }>;
}) {
  const route = await params;
  const query = (await searchParams).event;
  const event = typeof query === 'string' ? query : null;
  const page = readTournamentPage(
    route.slug,
    { kind: 'bracket', event },
    await requestSampleScene(),
  );
  if (page === null) notFound();
  return <TournamentPage page={page} />;
}
