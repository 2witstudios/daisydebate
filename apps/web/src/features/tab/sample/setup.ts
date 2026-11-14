import type {
  SetupEvent,
  TournamentSetupView,
} from '@daisy/protocol/lobby/lobby-setup-read';
import { eventChain } from '@daisy/protocol/setting-resolution';
import type { SettingScope } from '@daisy/protocol/settings';
import { choice, linkTo, sampleAction } from '../action';
import { resolvedSettingsViewOf } from '../reads/resolved-settings';
import { hostRoutes } from '../routes';
import type {
  SetupCopy,
  TournamentSetupContext,
  TournamentSetupReads,
} from '../setup';
import { varsitySwitch } from './event-switch';
import {
  leagueRows,
  sampleFormatDefaults,
  sampleScopeName,
  settingRow,
} from './league';
import { AUTUMN, LEAGUE_NAME, reached, VARSITY } from './moment';
import { sampleId, sampleIds, sampleNow } from './organization';
import type { SampleScene } from './scene';
import { tiebreaks } from './standings';

const league = { organizationId: sampleIds.league, name: LEAGUE_NAME };
export const varsityEventId = sampleId('varsitydebate');
const autumnScope: SettingScope = { kind: 'lobby', id: sampleIds.autumn };
const varsityScope: SettingScope = { kind: 'event', id: varsityEventId };
const autumnPoolId = sampleId('autumnpool');

/** Autumn Open's own rows and its Varsity event's. */
const autumnRows = [
  settingRow(autumnScope, 'judging.panel', {
    preliminary: { size: 1, decision: 'majority' },
    elimination: { size: 3, decision: 'majority' },
  }),
  settingRow(autumnScope, 'resolution.rule', {
    method: 'strike',
    drawSize: 5,
    strikeWindowMs: 120_000,
    firstStriker: 0,
  }),
  settingRow(autumnScope, 'audience.posting', {
    responsible_adults: 'at_once',
    competitors: 'at_once',
    participants: 'at_once',
    link: 'at_once',
    public: 'never',
  }),
  settingRow(autumnScope, 'conflict.handling', { value: 'second_confirms' }),
  settingRow(varsityScope, 'pairing.preset', { value: 'swiss_power' }),
];

/** Slots are in the tournament's time; the sample keeps them at UTC. */
export const slot = (
  key: string,
  name: string,
  time: string,
  day = '2026-11-14',
) => ({
  timeSlotId: sampleId(`slot${key}`),
  name,
  startsAt: `${day}T${time}:00.000Z`,
});

/**
 * One event: its preliminary rounds each in a slot, then an elimination
 * stage whose first round opens the break slot.
 */
export function sampleEvent(
  key: string,
  name: string,
  shape: {
    readonly formatName: string;
    readonly prelims: readonly string[];
    readonly elimination: readonly [string, number];
    readonly poolId?: string | null;
    readonly template?: SetupEvent['template'];
    readonly sanction?: SetupEvent['sanction'];
  },
): SetupEvent {
  const prelim = sampleId(`stage${key}prelim`);
  const elim = sampleId(`stage${key}elim`);
  const [breakSlot, eliminationRounds] = shape.elimination;
  return {
    eventId: sampleId(key),
    name,
    label: null,
    entryKind: 'person',
    format: {
      formatId: sampleId(`format${shape.formatName}`),
      formatVersion: 1,
      name: shape.formatName,
    },
    ballotDefinition: null,
    template: shape.template ?? null,
    stages: [
      {
        stageId: prelim,
        kind: 'preliminary',
        sequence: 1,
        division: null,
        place: 'online',
        timing: 'live',
      },
      {
        stageId: elim,
        kind: 'elimination',
        sequence: 2,
        division: null,
        place: 'online',
        timing: 'live',
      },
    ],
    tabRounds: [
      ...shape.prelims.map((slotId, index) => ({
        tabRoundId: sampleId(`round${key}${index + 1}`),
        stageId: prelim,
        number: index + 1,
        name: null,
        timeSlotId: slotId,
        resolutionPoolId: shape.poolId ?? null,
      })),
      ...Array.from({ length: eliminationRounds }, (_, index) => ({
        tabRoundId: sampleId(`round${key}e${index + 1}`),
        stageId: elim,
        number: shape.prelims.length + index + 1,
        name: null,
        timeSlotId: index === 0 ? breakSlot : null,
        resolutionPoolId: shape.poolId ?? null,
      })),
    ],
    sanction: shape.sanction ?? null,
  };
}

const debate = ['1000', '1140', '1320', '1500'].map((time) =>
  slot(`autumn${time}`, 'Debate', `${time.slice(0, 2)}:${time.slice(2)}`),
);
const debateBreak = slot('autumnbreak', 'break', '16:45');
const speech = [slot('autumn1050', 'Speech', '10:50'), slot('autumn1410', 'Speech', '14:10')];
const speechFinal = slot('autumnfinal', 'final', '17:10');
const ids = (slots: readonly { readonly timeSlotId: string }[]) =>
  slots.map((one) => one.timeSlotId);

/** Autumn Open's setup as its Director reads it. */
export function sampleAutumnSetup(scene: SampleScene): TournamentSetupView {
  const before = !reached(scene, 'prelims');
  const leagueDebate = { formatName: 'League one-on-one', poolId: autumnPoolId };
  return {
    kind: 'tournament',
    lobbyId: sampleIds.autumn,
    handle: AUTUMN,
    name: 'Autumn Open',
    owner: league,
    status: before ? 'open' : 'running',
    events: [
      sampleEvent('varsitydebate', 'Varsity debate', {
        ...leagueDebate,
        prelims: ids(debate),
        elimination: [debateBreak.timeSlotId, 3],
        template: {
          templateId: sampleIds.varsityTemplate,
          name: 'Varsity debate',
          organization: league,
        },
        sanction: {
          organization: league,
          status: before ? 'requested' : 'approved',
          requestedAt: '2026-11-12T16:00:00.000Z',
        },
      }),
      sampleEvent('noviceautumn', 'Novice debate', {
        ...leagueDebate,
        prelims: ids(debate),
        elimination: [debateBreak.timeSlotId, 2],
      }),
      sampleEvent('impromptuautumn', 'Impromptu', {
        formatName: 'Sections of six, ranked',
        prelims: ids(speech),
        elimination: [speechFinal.timeSlotId, 1],
      }),
    ],
    timeSlots: [...debate, debateBreak, ...speech, speechFinal],
    resolutionPools: [
      { resolutionPoolId: autumnPoolId, name: 'Autumn Open', size: before ? 18 : 20 },
    ],
    capabilities: { manage: true },
  };
}

const change = sampleAction('Change');

/** The words setup uses for the sample's values. */
const setupCopy: SetupCopy = {
  lines: [
    {
      subject: 'format',
      keys: ['format'],
      label: 'Format',
      value: 'One-on-one, limited prep · 7 segments · 26 minutes',
    },
    {
      subject: 'stages',
      keys: ['stage.structure', 'stage.place', 'stage.timing'],
      label: 'Rounds',
      value: '4 prelims, then top 8 · online · everyone at once',
      edit: change,
    },
    {
      subject: 'ballot.definition',
      keys: ['ballot.definition'],
      label: 'Ballot',
      value:
        'One score per speaker, 20 to 30 in halves · no low-point wins · no ties · double loss allowed in prelims',
      // The template pins the whole ballot, so its page is there to read.
      view: linkTo('View', hostRoutes.ballot(AUTUMN, VARSITY)),
    },
    {
      subject: 'setting',
      keys: ['judging.panel'],
      label: 'Judges',
      value: '1 per room in prelims · 3 in elims · 5 in the final · AI judge off',
      edit: change,
    },
    {
      subject: 'resolutions',
      keys: ['resolution.rule'],
      label: 'Resolutions',
      value: 'Each room strikes from 5 drawn from your pool',
      resolutions: hostRoutes.resolutions(AUTUMN, VARSITY),
    },
    {
      subject: 'setting',
      keys: ['pairing.preset'],
      label: 'Pairing',
      value: 'Power-matched preset · 3 rules, 3 preferences, 1 warning',
      edit: linkTo('Open', hostRoutes.setup(AUTUMN, 'pairing')),
    },
    {
      subject: 'setting',
      keys: ['standings.tiebreaks'],
      label: tiebreaks.label,
      value: tiebreaks.value,
    },
    {
      subject: 'setting',
      keys: [
        'audience.decision',
        'audience.scores',
        'audience.reason',
        'audience.feedback',
      ],
      label: 'Ballot release',
      value:
        'Coaches and parents each round · competitors after prelims · public at the break',
      edit: change,
    },
    {
      subject: 'setting',
      keys: ['audience.posting'],
      label: 'Who can see it',
      value: 'Postings: anyone with the link · Results: public',
      edit: change,
    },
    {
      subject: 'setting',
      keys: ['recording.capture', 'audience.video'],
      label: 'Recording',
      value: 'Recorded · video for the people in each round',
    },
    {
      subject: 'setting',
      keys: ['conflict.handling'],
      label: 'Staff with a connection to a room',
      value: 'A second person confirms',
      edit: change,
    },
    { subject: 'sanction', label: 'Counts for' },
  ],
  pairing: {
    preset: choice('Pairing preset', ['Power-matched', 'Random', 'Round robin']),
    summary: `Round 1 is seeded by ${LEAGUE_NAME} rating. Later rounds pair by record through the round before.`,
    policies: [
      { key: 'pairing.no_rematch', label: 'No rematch', force: 'rule', rank: null },
      {
        key: 'pairing.one_bye',
        label: 'One bye per entry',
        force: 'rule',
        rank: null,
      },
      {
        key: 'judging.not_own_school',
        label: 'Judge not from either school',
        force: 'rule',
        rank: null,
      },
      {
        key: 'pairing.same_record',
        label: 'Same record',
        force: 'preference',
        rank: 1,
      },
      {
        key: 'pairing.avoid_same_school',
        label: 'Avoid same school',
        force: 'preference',
        rank: 2,
      },
      {
        key: 'pairing.balance_sides',
        label: 'Balance sides',
        force: 'preference',
        rank: 3,
      },
      {
        key: 'judging.seen_before',
        label: 'Judge seen this entry before',
        force: 'warning',
        rank: null,
      },
    ],
    forceNote: `A host picks a preset. ${LEAGUE_NAME} can set each of these individually in its template.`,
    save: sampleAction('Save pairing', true),
  },
};

/** Varsity debate's settings, asked at the event by the Director. */
export const sampleVarsitySettings = () =>
  resolvedSettingsViewOf(
    {
      at: { kind: 'event', id: varsityEventId },
      chain: eventChain({
        template: {
          id: sampleIds.varsityTemplate,
          organizationId: sampleIds.league,
        },
        leagueId: sampleIds.league,
        lobbyId: sampleIds.autumn,
        eventId: varsityEventId,
      }),
      rows: [...leagueRows, ...autumnRows],
      format: sampleFormatDefaults,
      scopeName: sampleScopeName,
      reads: 'event',
    },
    true,
  );

/** The reads setup is drawn from, and its words. */
export function sampleSetup(
  slug: string,
  scene: SampleScene,
): {
  readonly reads: TournamentSetupReads;
  readonly context: TournamentSetupContext;
} | null {
  if (slug !== AUTUMN) return null;
  return {
    reads: {
      setup: sampleAutumnSetup(scene),
      eventId: varsityEventId,
      settings: sampleVarsitySettings(),
    },
    context: { event: varsitySwitch(scene), now: sampleNow, copy: setupCopy },
  };
}
