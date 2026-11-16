import { systemId } from '@daisy/clock';
import { tournamentEventSettingsViewSchema } from '@daisy/protocol/lobby/resolved-settings-read';
import { standingsViewSchema } from '@daisy/protocol/lobby/standings-read';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { readOwnRoute } from '../../../../../(shell)/friends/read-route';
import { linkTo } from '../../../../../../features/tab/action';
import { hostNavigationRail } from '../../../../../../features/tab/host-navigation';
import { hostStandingsPath } from '../../../../../../features/tab/host-standings-route';
import { requireTabRelease } from '../../../../../../features/tab/release';
import { hostRoutes } from '../../../../../../features/tab/routes';
import { settingLineOf } from '../../../../../../features/tab/settings';
import { standingsTableOf } from '../../../../../../features/tab/standings';

import { tournamentEventSettingsPath } from '../../../../../../features/tab/tournament-event-settings-route';
import { CompletionCommandForm } from '../../../../../../ui/tab/completion/completion-command-form';
import { HostStandings } from '../../../../../../ui/tab/standings/host-standings';
import { GET as standingsGET } from '../../../../../api/tab/host-standings/route';
import { GET as settingsGET } from '../../../../../api/tab/tournament-event-settings/route';
import { readStoredHostNavigation } from '../../../read-navigation';
import { eventCompletionAction } from '../completion-actions';

export const metadata: Metadata = { title: 'Standings' };

export default async function Page({
  params,
  searchParams,
}: {
  readonly params: Promise<{ slug: string }>;
  readonly searchParams: Promise<{ event?: string | string[] }>;
}) {
  const { slug } = await params;
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
      announcement={
        read.visibility === 'official' &&
        read.capabilities.announceBreak &&
        read.progress.kind === 'complete' &&
        read.breakAnnouncedAt === null &&
        read.rows.some((row) => row.decidesBreak) ? (
          <CompletionCommandForm
            label="Announce this event’s break"
            submitLabel="Announce break"
            action={eventCompletionAction.bind(null, {
              commandId: systemId.next(),
              lobbyId: navigation.id,
              eventId: selected.eventId,
              handle: slug,
              target: {
                type: 'announce-break',
                resultsVersion: read.resultsVersion,
              },
            })}
          >
            {null}
          </CompletionCommandForm>
        ) : undefined
      }
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
