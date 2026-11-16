import { hostRosterViewSchema } from '@daisy/protocol/lobby/entry-read';
import { notFound } from 'next/navigation';
import { readOwnRoute } from '../../../../../(shell)/friends/read-route';
import { linkTo } from '../../../../../../features/tab/action';
import {
  hostEntriesOf,
  hostJudgesOf,
} from '../../../../../../features/tab/entries';

import { hostNavigationRail } from '../../../../../../features/tab/host-navigation';
import { hostRosterPath } from '../../../../../../features/tab/host-roster-route';
import { requireTabRelease } from '../../../../../../features/tab/release';
import { hostRoutes } from '../../../../../../features/tab/routes';
import { HostEntries } from '../../../../../../ui/tab/host-entries/host-entries';
import { HostJudges } from '../../../../../../ui/tab/host-entries/host-judges';
import { GET } from '../../../../../api/tab/host-roster/route';
import { readStoredHostNavigation } from '../../../read-navigation';
export async function StoredRoster({
  handle,
  kind,
  eventId,
}: {
  readonly handle: string;
  readonly kind: 'entries' | 'judges';
  readonly eventId?: string | undefined;
}) {
  await requireTabRelease();
  const navigation = await readStoredHostNavigation('lobby', handle);
  if (!navigation) notFound();
  const view = await readOwnRoute(
    GET,
    hostRosterPath(navigation.id, eventId),
    hostRosterViewSchema,
  );
  if (!view) notFound();
  const rail = hostNavigationRail(navigation);
  const entriesHref = hostRoutes.entries(handle),
    judgesHref = hostRoutes.judges(handle);
  if (kind === 'judges') {
    const judges = hostJudgesOf(view.judges);
    return (
      <HostJudges
        rail={rail}
        judges={{ ...judges, add: null }}
        entriesHref={entriesHref}
        judgesHref={judgesHref}
      />
    );
  }
  const events = view.judges.events;
  const current = events.find((e) => e.id === view.entries.eventId);
  const entries = hostEntriesOf(view.entries, {
    current: current?.name ?? 'No events',
    position: current
      ? `${events.findIndex((e) => e.id === current.id) + 1} of ${events.length}`
      : '',
    others: events
      .filter((e) => e.id !== current?.id)
      .map((e) =>
        linkTo(e.name, `${entriesHref}?event=${encodeURIComponent(e.id)}`),
      ),
  });
  return (
    <HostEntries
      rail={rail}
      entries={{
        ...entries,
        actions: [],
        note: 'Judge obligations are unconfigured. Judge school groups show affiliation; they do not establish who furnished a judge.',
      }}
      entriesHref={entriesHref}
      judgesHref={judgesHref}
    />
  );
}
