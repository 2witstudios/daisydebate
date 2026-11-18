import { createId } from '@paralleldrive/cuid2';
import { tournamentEventSettingsViewSchema } from '@daisy/protocol/lobby/resolved-settings-read';
import { settingValueSchemas } from '@daisy/protocol/setting-values';
import { tournamentEventSettingsPath } from '../../../../../../features/tab/tournament-event-settings-route';
import { resolvedEntry } from '../../../../../../features/tab/reads/resolved-settings';
import { JudgeObligationForm } from '../../../../../../ui/tab/host-entries/judge-obligation-form';
import { GET as settingsGET } from '../../../../../api/tab/tournament-event-settings/route';
import { judgeObligationAction } from './actions';
import { notFound } from 'next/navigation';
import { hostRosterViewSchema } from '@daisy/protocol/lobby/entry-read';
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
  const settings = view.entries.eventId
    ? await readOwnRoute(
        settingsGET,
        tournamentEventSettingsPath(
          navigation.id,
          view.entries.eventId,
          'entries',
        ),
        tournamentEventSettingsViewSchema,
      )
    : null;
  const obligation = settings
    ? resolvedEntry(settings, 'entry.judge_obligation')
    : null;
  const policy = obligation
    ? settingValueSchemas['entry.judge_obligation'].parse(obligation.value)
    : null;
  return (
    <HostEntries
      rail={rail}
      entries={{
        ...entries,
        actions: [],
        note:
          policy?.kind !== 'ratio'
            ? 'Judge obligations are unconfigured. Judge school groups show affiliation; they do not establish who furnished a judge.'
            : 'School obligations count accepted entries. Judges shown are accepted, eligible and cleared for this event; school groups show their affiliation.',
      }}
      obligationEditor={
        settings && obligation?.locked === null && view.entries.eventId ? (
          <JudgeObligationForm
            entries={
              policy?.kind === 'ratio' ? String(policy.entriesPerJudge) : ''
            }
            judges={
              policy?.kind === 'ratio' ? String(policy.judgesPerGroup) : ''
            }
            action={judgeObligationAction.bind(null, {
              eventId: view.entries.eventId,
              settingsVersion: settings.settingsVersion,
              commandId: createId(),
              handle,
            })}
          />
        ) : obligation ? (
          <p className="text-sm text-ink-muted">
            Judge obligations:{' '}
            {policy?.kind === 'ratio'
              ? `${policy.judgesPerGroup} judges per ${policy.entriesPerJudge} accepted entries`
              : 'unconfigured'}
            .{' '}
            {obligation.source.kind === 'catalogue'
              ? "Daisy's default"
              : 'name' in obligation.source
                ? `Set by ${obligation.source.name}`
                : ''}
            {obligation.locked === 'enforced' ? ' · Enforced' : ''}
          </p>
        ) : null
      }
      entriesHref={entriesHref}
      judgesHref={judgesHref}
    />
  );
}
