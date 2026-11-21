import { commandAction, unavailableAction } from './action';
import {
  pairingForceKeys,
  judgingForceKeys,
} from '@daisy/protocol/setting-forces';
import { settingValueSchemas } from '@daisy/protocol/setting-values';
import type { TournamentSetupView } from '@daisy/protocol/lobby/lobby-setup-read';
import type { TournamentEventSettingsView } from '@daisy/protocol/lobby/resolved-settings-read';
import type { HostingAccountReadView } from '@daisy/protocol/lobby/hosting-read';
import { linkTo } from './action';
import { hostRoutes } from './routes';
import {
  tournamentSetupOf,
  type SetupCopy,
  type StoredTournamentSetup,
} from './setup';
import {
  pairingSummary,
  presetLabels,
  setupSettingWords,
  setupValue,
} from './setup-values';
import type { TimelineRail } from './tournament';

/** Setup metadata never claims a draw, posting or certification it did not read. */
export const setupRailOf = (view: TournamentSetupView): TimelineRail => ({
  title: view.name,
  subtitle: view.owner?.name ?? null,
  heading: null,
  items: [
    {
      id: 'setup',
      label: 'Setup',
      time: null,
      standing: null,
      action: linkTo('Setup', hostRoutes.setup(view.handle)),
    },
    {
      id: 'events',
      label: 'Events and schedule',
      time: null,
      standing: { kind: 'note', text: String(view.events.length) },
      action: linkTo('Events and schedule', hostRoutes.events(view.handle)),
    },
    {
      id: 'entries',
      label: 'Entries',
      time: null,
      standing: null,
      action: linkTo('Entries', hostRoutes.entries(view.handle)),
    },
    {
      id: 'judges',
      label: 'Judges',
      time: null,
      standing: null,
      action: linkTo('Judges', hostRoutes.judges(view.handle)),
    },
  ],
  footHeading: null,
  foot: [
    {
      id: 'people',
      label: 'People',
      time: null,
      standing: null,
      action: linkTo('People', hostRoutes.people(view.handle)),
    },
  ],
});
const policyLabels = {
  'pairing.rematch': 'No rematch',
  'pairing.same_school': 'Avoid same school',
  'pairing.side_balance': 'Balance sides',
  'pairing.side_alternation': 'Alternate sides',
  'pairing.pull_up': 'Pull up entries',
  'pairing.position_balance': 'Balance positions',
  'pairing.section_repeat': 'Avoid repeated sections',
  'bye.repeat': 'One bye per entry',
  'judging.availability': 'Judge available',
  'judging.strike': 'Respect judge strikes',
  'judging.conflict': 'Judge without a conflict',
  'judging.same_school': 'Judge from another school',
  'judging.repeat_judge': 'Avoid repeat judges',
  'judging.unsubmitted_ballot': 'Judge has submitted earlier ballots',
  'judging.load_balance': 'Balance judge load',
  'judging.chair': 'Assign a chair',
  'judging.panel_same_school': 'Panel from different schools',
} as const;
const settingLabels = {
  'judging.panel': 'Judges',
  'pairing.preset': 'Pairing',
  'entry.age_division': 'Style and division',
  'standings.tiebreaks': 'Tiebreaks',
  'recording.capture': 'Recording',
  'conflict.handling': 'Staff with a connection to a room',
  'audience.posting': 'Postings',
  'audience.decision': 'Decisions',
  'audience.scores': 'Scores',
  'audience.reason': 'Reasons',
  'audience.feedback': 'Feedback',
  'audience.video': 'Video',
} as const;
export const storedSetupOf = (
  view: TournamentSetupView,
  settings: TournamentEventSettingsView,
  now: string,
  nextId?: () => string,
  hosting?: HostingAccountReadView | null,
): StoredTournamentSetup | null => {
  if (settings.at.kind !== 'event') return null;
  const eventId = settings.at.id;
  const event = view.events.find((one) => one.eventId === eventId);
  if (!event) return null;
  const address = (panel: 'pairing' | null = null, eventId = event.eventId) =>
    `${hostRoutes.setup(view.handle, panel)}${panel ? '&' : '?'}event=${eventId}`;
  const values = setupSettingWords(settings);
  const pairingOrder = setupValue(settings, 'pairing.preference_order').order;
  const judgingOrder = setupValue(settings, 'judging.preference_order').order;
  const copy: SetupCopy = {
    lines: [
      {
        subject: 'format',
        keys: ['format'],
        label: 'Format',
        value: `${event.format.name} · version ${event.format.formatVersion}`,
      },
      {
        subject: 'ballot.definition',
        keys: ['ballot.definition'],
        label: 'Ballot',
        value: event.ballotDefinition?.name ?? 'Daisy ballot',
        edit: linkTo(
          'Ballot details',
          hostRoutes.ballot(view.handle, event.eventId),
        ),
        view: linkTo(
          'Ballot details',
          hostRoutes.ballot(view.handle, event.eventId),
        ),
      },
      {
        subject: 'stages',
        keys: ['stage.structure', 'stage.place', 'stage.timing'],
        label: 'Rounds',
        value: event.stages
          .map(
            (stage) =>
              `${event.tabRounds.filter((round) => round.stageId === stage.stageId).length} ${stage.kind === 'preliminary' ? 'preliminary' : 'elimination'} rounds · ${stage.place} · ${stage.timing === 'live' ? 'everyone at once' : 'windowed'}`,
          )
          .join('; '),
        edit: view.capabilities.manage
          ? linkTo('Change', hostRoutes.events(view.handle, event.eventId))
          : null,
      },
      ...Object.entries(settingLabels).map(([key, label]) => ({
        subject: 'setting' as const,
        keys: [key as keyof typeof settingLabels] as const,
        label,
        value: values[key as keyof typeof settingLabels],
        ...(key === 'pairing.preset' && view.capabilities.manage
          ? { edit: linkTo('Open', address('pairing')) }
          : {}),
      })),
      {
        subject: 'resolutions',
        keys: ['resolution.rule'],
        label: 'Resolutions',
        value: values['resolution.rule'],
        resolutions: hostRoutes.resolutions(view.handle, event.eventId),
      },
      { subject: 'sanction', label: 'Counts for' },
    ],
    pairing: {
      preset: {
        label: 'Pairing preset',
        value: presetLabels[setupValue(settings, 'pairing.preset').value],
        options: Object.values(presetLabels),
        helper: null,
      },
      summary: pairingSummary(settings),
      policies: [...pairingForceKeys, ...judgingForceKeys].map((key) => {
        const preferenceOrder = key.startsWith('judging.')
          ? judgingOrder
          : pairingOrder;
        const force = settingValueSchemas[key].parse(
          settings.settings.find((row) => row.key === key)?.value,
        ).force;
        return {
          key,
          label: policyLabels[key],
          force,
          rank:
            force === 'preference'
              ? preferenceOrder
                  .filter(
                    (one) =>
                      settingValueSchemas[one].parse(
                        settings.settings.find((row) => row.key === one)?.value,
                      ).force === 'preference',
                  )
                  .findIndex((one) => one === key) + 1
              : null,
        };
      }),
      forceNote: event.template
        ? `${event.template.organization.name} sets individual policies in its template.`
        : 'Individual policies come from the preset and inherited settings.',
      save:
        nextId &&
        view.capabilities.manage &&
        settings.settings.find((row) => row.key === 'pairing.preset')
          ?.locked === null
          ? commandAction(
              'Save pairing',
              {
                eventId,
                settingsVersion: settings.settingsVersion,
                commandId: nextId(),
                handle: view.handle,
              },
              true,
            )
          : unavailableAction('Save pairing', true),
    },
  };
  const projected = tournamentSetupOf(
    { setup: view, eventId: event.eventId, settings },
    {
      event: {
        current: event.name,
        position: `${view.events.indexOf(event) + 1} of ${view.events.length}`,
        others: view.events
          .filter((one) => one.eventId !== event.eventId)
          .map((one) => linkTo(one.name, address(null, one.eventId))),
      },
      now,
      copy,
    },
  );
  if (!projected) return null;
  const enabled = (
    key: 'recording.capture' | 'judging.ai_judge' | 'broadcast.live',
  ) => {
    const setting = settingValueSchemas[key].safeParse(
      settings.settings.find((row) => row.key === key)?.value,
    );
    return setting.success && setting.data.value === 'on';
  };
  return {
    ...projected,
    settings:
      hosting?.tier === 'free'
        ? projected.settings.filter(
            (setting) => !setting.keys.includes('recording.capture'),
          )
        : projected.settings,
    hosted: hosting
      ? {
          account: hosting,
          states: {
            recording: enabled('recording.capture'),
            ai_judging: enabled('judging.ai_judge'),
            broadcast: enabled('broadcast.live'),
          },
          upgradeHref: hostRoutes.upgrade(view.handle),
        }
      : null,
  };
};
