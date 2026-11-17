import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { createId } from '@paralleldrive/cuid2';
import { hostRoutes, tabRoutes } from '../../../../../features/tab/routes';
import {
  storedHostLeagueOf,
  storedLeagueRail,
} from '../../../../../features/tab/stored-league';
import { requestLeaguePage } from '../../../../../lib/request-session';
import { requireAccess } from '../../../../../lib/access';
import { HostLeague } from '../../../../../ui/tab/host-league/host-league';
import { SanctionDecisionForm } from '../../../../../ui/tab/host-league/sanction-decision-form';
import { sanctionDecisionAction } from './actions';
export const metadata: Metadata = { title: 'League' };
export default async function Page({
  params,
  searchParams,
}: {
  readonly params: Promise<{ slug: string }>;
  readonly searchParams: Promise<{ season?: string; event?: string }>;
}) {
  const { slug } = await params;
  await requireAccess(hostRoutes.league(slug), searchParams);
  const query = await searchParams;
  const read = await requestLeaguePage(slug, {
    addressKind: 'organization',
    ...(query.season ? { seasonId: query.season } : {}),
    ...(query.event ? { templateId: query.event } : {}),
  });
  if (!read) notFound();
  if (!read.season.canHost) {
    if (read.season.standingLobby)
      redirect(tabRoutes.league(read.season.standingLobby.handle, 'season'));
    notFound();
  }
  const league = storedHostLeagueOf(slug, read.season);
  return (
    <HostLeague
      rail={storedLeagueRail(slug, read.season)}
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
