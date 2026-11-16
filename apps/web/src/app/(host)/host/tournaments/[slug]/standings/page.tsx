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
import { readStoredHostNavigation } from '../../../read-navigation';
import { hostNavigationRail } from '../../../../../../features/tab/host-navigation';
import { linkTo } from '../../../../../../features/tab/action';
import { settingLineOf } from '../../../../../../features/tab/settings';
import { tournamentEventSettingsViewSchema } from '@daisy/protocol/lobby/resolved-settings-read';
import { tournamentEventSettingsPath } from '../../../../../../features/tab/tournament-event-settings-route';
import { GET as settingsGET } from '../../../../../api/tab/tournament-event-settings/route';

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
    const navigation = await readStoredHostNavigation('lobby', slug);
    if (!navigation) notFound();
    const selected =
      typeof event === 'string'
        ? navigation.events.find((one) => one.eventId === event)
        : navigation.events[0];
    if (!selected) notFound();
    const read = await readOwnRoute(
      standingsGET,
      hostStandingsPath(navigation.id, selected.eventId),
      standingsViewSchema,
    );
    if (!read) notFound();
    const settings = await readOwnRoute(
      settingsGET,
      tournamentEventSettingsPath(navigation.id, selected.eventId, 'results'),
      tournamentEventSettingsViewSchema,
    );
    const resolved = settings?.settings.find(
      (setting) => setting.key === 'standings.tiebreaks',
    );
    if (!resolved) notFound();
    const tiebreaks = settingLineOf(resolved, {
      keys: ['standings.tiebreaks'],
      label: 'Tiebreaks',
      value: read.tiebreaks
        .map((metric) => metric.replaceAll('_', ' '))
        .join(' → '),
    });
    const table = standingsTableOf(read, tiebreaks);
    return (
      <HostStandings
        rail={hostNavigationRail(navigation)}
        event={{
          current: selected.name,
          position: `${navigation.events.indexOf(selected) + 1} of ${navigation.events.length}`,
          others: navigation.events
            .filter((one) => one.eventId !== selected.eventId)
            .map((one) =>
              linkTo(
                one.name,
                `${hostRoutes.standings(slug)}?event=${one.eventId}`,
              ),
            ),
        }}
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
