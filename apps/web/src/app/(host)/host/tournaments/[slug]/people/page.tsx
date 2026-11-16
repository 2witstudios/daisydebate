import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { lobbyPeopleViewSchema } from '@daisy/protocol/lobby/lobby-people-read';
import { requireTabRelease } from '../../../../../../features/tab/release';
import { lobbyPeoplePath } from '../../../../../../features/tab/lobby-people-route';
import { lobbyPeoplePage } from '../../../../../../features/tab/lobby-people';
import { hostNavigationRail } from '../../../../../../features/tab/host-navigation';
import { hostRoutes } from '../../../../../../features/tab/routes';
import { requestIdentity } from '../../../../../../lib/request-session';
import { People } from '../../../../../../ui/tab/people/people';
import { readStoredHostNavigation } from '../../../read-navigation';
import { readOwnRoute } from '../../../../../(shell)/friends/read-route';
import { GET } from '../../../../../api/tab/lobby-people/route';
import { lobbyPeopleControls } from './controls';
export const metadata: Metadata = { title: 'People' };

export default async function Page({
  params,
  searchParams,
}: {
  readonly params: Promise<{ slug: string }>;
  readonly searchParams: Promise<{ role?: string | string[] }>;
}) {
  await requireTabRelease();
  const { slug } = await params;
  const navigation = await readStoredHostNavigation('lobby', slug);
  if (!navigation) notFound();
  const view = await readOwnRoute(
    GET,
    lobbyPeoplePath(navigation.id),
    lobbyPeopleViewSchema,
  );
  if (!view) notFound();
  const identity = await requestIdentity();
  if (identity.state !== 'member') notFound();
  const { role } = await searchParams;
  return (
    <People
      rail={hostNavigationRail(navigation)}
      people={lobbyPeoplePage(view, {
        role: typeof role === 'string' ? role : null,
        basePath: hostRoutes.people(slug),
        viewerId: identity.principal.userId,
      })}
      controls={lobbyPeopleControls(view, slug)}
    />
  );
}
