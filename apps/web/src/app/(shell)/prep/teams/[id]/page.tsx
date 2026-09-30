import type { Metadata } from 'next';
import type { SearchParams } from '../../../../../features/access/decision';
import { getTeam } from '../../../../../features/prep/get-team';
import {
  parseTeamQuery,
  teamView,
} from '../../../../../features/prep/team-view';
import { requireAccess } from '../../../../../lib/access';
import { NotFoundPanel } from '../../../../../ui/prep/not-found/not-found-panel';
import { TeamPage } from '../../../../../ui/prep/team-page/team-page';

export const metadata: Metadata = { title: 'Team' };

export default async function TeamRoute({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  await requireAccess(`/prep/teams/${id}`, searchParams);
  const team = getTeam(id);
  if (team === undefined)
    return (
      <NotFoundPanel what="team" backHref="/prep" backLabel="Back to Prep" />
    );
  return <TeamPage view={teamView(team, parseTeamQuery(await searchParams))} />;
}
