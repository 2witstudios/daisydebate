import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { leagueViewOf, readLeagueLobby } from '../../../../features/tab/league';
import { requestSampleScene } from '../../../../features/tab/sample/request-scene';
import { LeagueLobby } from '../../../../ui/tab/league-lobby/league-lobby';

export const metadata: Metadata = { title: 'League' };

type Query = Readonly<Record<string, string | string[] | undefined>>;

const one = (query: Query, key: string): string | null => {
  const value = query[key];
  return typeof value === 'string' ? value : null;
};

export default async function Page({
  params,
  searchParams,
}: {
  readonly params: Promise<{ slug: string }>;
  readonly searchParams: Promise<Query>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const lobby = readLeagueLobby(
    slug,
    leagueViewOf({
      tab: one(query, 'tab'),
      scope: one(query, 'scope'),
      search: one(query, 'q'),
      event: one(query, 'event'),
    }),
    await requestSampleScene(),
  );
  if (lobby === null) notFound();
  return <LeagueLobby lobby={lobby} />;
}
