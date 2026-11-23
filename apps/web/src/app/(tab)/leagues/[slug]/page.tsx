import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { leagueViewOf } from '../../../../features/tab/league-view';
import { storedLeagueLobbyOf } from '../../../../features/tab/stored-league';
import { tabRoutes } from '../../../../features/tab/routes';
import { requestLeaguePage } from '../../../../features/tab/page-reads';
import { requireAccess } from '../../../../lib/access';
import { LeagueLobby } from '../../../../ui/tab/league-lobby/league-lobby';
export const metadata: Metadata = { title: 'League' };
type Query = Readonly<Record<string, string | string[] | undefined>>;
const one = (query: Query, key: string) =>
  typeof query[key] === 'string' ? query[key] : null;
export default async function Page({
  params,
  searchParams,
}: {
  readonly params: Promise<{ slug: string }>;
  readonly searchParams: Promise<Query>;
}) {
  const { slug } = await params;
  await requireAccess(tabRoutes.league(slug), searchParams);
  const query = await searchParams;
  const view = leagueViewOf({
    tab: one(query, 'tab'),
    scope: one(query, 'scope'),
    search: one(query, 'q'),
    event: one(query, 'event'),
  });
  const pageNumber = Number(one(query, 'page') ?? '1');
  const season = one(query, 'season');
  const read = await requestLeaguePage(slug, {
    addressKind: 'standing',
    ...(season ? { seasonId: season } : {}),
    ...(view.tab === 'season' && view.event ? { templateId: view.event } : {}),
    ...(view.tab === 'ladder'
      ? {
          ladder: {
            scope: view.scope,
            search: view.search,
            page: Number.isSafeInteger(pageNumber) ? pageNumber : 1,
          },
        }
      : {}),
  });
  if (!read || (view.tab === 'rooms' && !read.season.rooms)) notFound();
  return (
    <LeagueLobby
      lobby={storedLeagueLobbyOf(
        slug,
        read.season,
        view,
        read.ladder,
        read.season.rooms,
      )}
    />
  );
}
