import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { createId } from '@paralleldrive/cuid2';
import { hostRoutes, tabRoutes } from '../../../../../features/tab/routes';
import {
  storedHostLeagueOf,
  storedLeagueRail,
} from '../../../../../features/tab/stored-league';
import {
  requestLeaguePage,
  requestStandingLobbyManagement,
} from '../../../../../lib/request-session';
import { requireAccess } from '../../../../../lib/access';
import { HostLeague } from '../../../../../ui/tab/host-league/host-league';
import { SanctionDecisionForm } from '../../../../../ui/tab/host-league/sanction-decision-form';
import { linkTo } from '../../../../../features/tab/action';
import type { TimelineRail } from '../../../../../features/tab/tournament';
import { HostShell } from '../../../../../ui/tab/host-shell/host-shell';
import { PageHeader } from '../../../../../ui/components/page-header/page-header';
import { StandingLobbies } from '../../../../../ui/tab/standing-lobby-management/lobbies';
import { StandingLobbyPage } from './standing-lobby-page';
import { sanctionDecisionAction } from './actions';
export const metadata: Metadata = { title: 'League' };
export default async function Page({
  params,
  searchParams,
}: {
  readonly params: Promise<{ slug: string }>;
  readonly searchParams: Promise<{
    season?: string;
    event?: string;
    area?: string;
    lobby?: string;
    panel?: string;
    item?: string;
  }>;
}) {
  const { slug } = await params;
  await requireAccess(hostRoutes.league(slug), searchParams);
  const query = await searchParams;
  const management = await requestStandingLobbyManagement(slug);
  const read = await requestLeaguePage(slug, {
    addressKind: 'organization',
    ...(query.season ? { seasonId: query.season } : {}),
    ...(query.event ? { templateId: query.event } : {}),
  });
  if (!management) {
    if (read?.season.standingLobby && !read.season.canHost)
      redirect(tabRoutes.league(read.season.standingLobby.handle, 'season'));
    notFound();
  }
  const rail: TimelineRail = read
    ? storedLeagueRail(slug, read.season)
    : {
        title: management.name,
        subtitle: null,
        heading: null,
        footHeading: null,
        items: [
          {
            id: 'league',
            label: 'League',
            time: null,
            standing: null,
            action: linkTo('League', hostRoutes.league(slug)),
          },
        ],
        foot: [],
      };
  if (query.area === 'lobbies')
    return (
      <StandingLobbyPage
        slug={slug}
        rail={rail}
        read={management}
        selection={query}
      />
    );
  const lobbies = <StandingLobbies slug={slug} read={management} />;
  if (!read)
    return (
      <HostShell rail={rail} current="league">
        <PageHeader title={management.name} />
        {lobbies}
      </HostShell>
    );
  const league = storedHostLeagueOf(slug, read.season);
  return (
    <HostLeague
      rail={rail}
      standingLobbies={lobbies}
      league={league}
      requestControls={(request) => {
        const row = read.season.requests.find(
          (row) => row.sanctionId === request.id,
        );
        if (!row || !read.season.canManage) return null;
        const context = {
          organizationId: read.season.view.organization.organizationId,
          lobbyId: row.lobbyId,
          sanctionId: row.sanctionId,
          version: row.version,
          handle: slug,
        };
        return (
          <>
            <SanctionDecisionForm
              event={row.lobbyName}
              label="Decline"
              action={sanctionDecisionAction.bind(null, {
                ...context,
                commandId: createId(),
                decision: 'decline-sanction',
              })}
            />
            <SanctionDecisionForm
              event={row.lobbyName}
              label="Sanction it"
              primary
              action={sanctionDecisionAction.bind(null, {
                ...context,
                commandId: createId(),
                decision: 'approve-sanction',
              })}
            />
          </>
        );
      }}
    />
  );
}
