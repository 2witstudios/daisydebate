import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { readSetup } from '../../../../../../features/tab/setup';
import { readStandings } from '../../../../../../features/tab/standings';
import { HostStandings } from '../../../../../../ui/tab/standings/host-standings';
import { hostRoutes } from '../../../../../../features/tab/routes';
import { readTimelineRail } from '../../../../../../features/tab/tournament';
import { requireGrant } from '../../../require-grant';
import { AUTUMN, WINTER } from '../../../../../../features/tab/sample/moment';
import { requireTabRelease } from '../../../../../../features/tab/release';
import { standingsTableOf } from '../../../../../../features/tab/standings';
import { standingsViewSchema } from '@daisy/protocol/lobby/standings-read';
import { hostStandingsPath } from '../../../../../../features/tab/host-standings-route';
import { readOwnRoute } from '../../../../../(shell)/friends/read-route';
import { GET as standingsGET } from '../../../../../api/tab/host-standings/route';
import { readStoredSetup } from '../setup/stored-setup';

export const metadata: Metadata = { title: 'Standings' };

export default async function Page({
  params,
  searchParams,
}: {
  readonly params: Promise<{ slug: string }>;
  readonly searchParams: Promise<{ event?: string | string[] }>;
}) {
  const { slug } = await params;
  if (slug !== AUTUMN && slug !== WINTER) {
    await requireTabRelease();
    const { event } = await searchParams;
    const stored = await readStoredSetup(
      slug,
      typeof event === 'string' ? event : null,
    );
    if (!stored || stored.kind !== 'configured') notFound();
    const read = await readOwnRoute(
      standingsGET,
      hostStandingsPath(stored.view.lobbyId, stored.event.eventId),
      standingsViewSchema,
    );
    if (!read) notFound();
    const tiebreaks = stored.setup.settings.find((setting) =>
      setting.keys.includes('standings.tiebreaks'),
    );
    if (!tiebreaks) notFound();
    const table = standingsTableOf(read, tiebreaks);
    return (
      <HostStandings
        rail={stored.rail}
        event={stored.setup.event}
        table={{ ...table, announce: null, correction: null }}
      />
    );
  }
  const scene = await requireGrant(hostRoutes.standings(slug));
  const rail = readTimelineRail(slug, scene);
  const table = readStandings(slug, null, scene);
  const setup = readSetup(slug, scene);
  if (rail === null || table === null || setup === null) notFound();
  return <HostStandings rail={rail} event={setup.event} table={table} />;
}
