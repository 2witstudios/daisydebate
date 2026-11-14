import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { readLeagueLobby } from '../../../../features/tab/league';
import type { LeagueTab } from '../../../../features/tab/routes';
import { requestSampleScene } from '../../../../features/tab/sample/request-scene';
import { LeagueLobby } from '../../../../ui/tab/league-lobby/league-lobby';

export const metadata: Metadata = { title: 'League' };

const tabs: readonly LeagueTab[] = ['rooms', 'ladder', 'season', 'tournaments'];

export default async function Page({
  params,
  searchParams,
}: {
  readonly params: Promise<{ slug: string }>;
  readonly searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const { slug } = await params;
  const { tab } = await searchParams;
  const lobby = readLeagueLobby(
    slug,
    tabs.find((known) => known === tab) ?? 'rooms',
    await requestSampleScene(),
  );
  if (lobby === null) notFound();
  return <LeagueLobby lobby={lobby} />;
}
