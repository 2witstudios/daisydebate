import type { OrganizationView } from '@daisy/protocol/lobby/organization-read';
import type { ResolvedSettingsView } from '@daisy/protocol/lobby/resolved-settings-read';
import type {
  SanctionList,
  SeasonView,
} from '@daisy/protocol/lobby/season-read';
import type { TemplateView } from '@daisy/protocol/lobby/template-read';
import type { SettingRow, SettingScope } from '@daisy/protocol/settings';
import type { FormatSettingDefaults } from '@daisy/protocol/setting-resolution';
import type { SettingKey, SettingValues } from '@daisy/protocol/setting-values';
import type { HostLeagueCopy, SeasonRow } from '../league';
import { resolvedSettingsViewOf } from '../reads/resolved-settings';
import { AUTUMN, LEAGUE, LEAGUE_NAME, reached, WINTER } from './moment';
import { own } from './own';
import { sampleId, sampleIds } from './organization';
import type { SampleScene } from './scene';

/** What the sample's pinned formats give `room.timing` and `room.floor`. */
export const sampleFormatDefaults: FormatSettingDefaults = {
  'room.timing': {
    preRoundPrepMs: 0,
    inRoundPrepMsPerSide: 240_000,
    countdownMs: 5_000,
  },
  'room.floor': {
    interruptions: { mode: 'disabled', minRemainingMs: 0 },
    yielding: { allowed: false, returnsTime: false },
  },
};

export const leagueScope: SettingScope = {
  kind: 'organization',
  id: sampleIds.league,
};
export const varsityTemplateScope: SettingScope = {
  kind: 'template',
  id: sampleIds.varsityTemplate,
};
export const leagueLobbyScope: SettingScope = {
  kind: 'lobby',
  id: sampleIds.leagueLobby,
};

export const settingRow = <Key extends SettingKey>(
  scope: SettingScope,
  key: Key,
  value: SettingValues[Key],
  hold: 'default' | 'enforced' = 'default',
): SettingRow => ({ scope, key, value, hold }) as SettingRow;

const tiebreakValue: SettingValues['standings.tiebreaks'] = {
  metrics: ['wins', 'total_points', 'opponent_wins', 'rating'],
  minimumGames: null,
  terminal: 'lot',
};
const videoValue: SettingValues['audience.video'] = {
  responsible_adults: 'prelims_end',
  competitors: 'prelims_end',
  participants: 'never',
  link: 'never',
  public: 'never',
};
export const sampleLadderId = sampleId('leagueladder');

/**
 * The league's rows: what it enforces on everything it owns, what its
 * Varsity template holds, and its standing lobby's own rows.
 */
export const leagueRows: readonly SettingRow[] = [
  settingRow(leagueScope, 'recording.capture', { value: 'on' }, 'enforced'),
  settingRow(leagueScope, 'audience.video', videoValue, 'enforced'),
  settingRow(leagueScope, 'standings.tiebreaks', tiebreakValue, 'enforced'),
  settingRow(
    varsityTemplateScope,
    'standings.tiebreaks',
    tiebreakValue,
    'enforced',
  ),
  settingRow(varsityTemplateScope, 'pairing.preset', { value: 'swiss_power' }),
  settingRow(
    varsityTemplateScope,
    'recording.capture',
    { value: 'on' },
    'enforced',
  ),
  settingRow(varsityTemplateScope, 'audience.video', videoValue, 'enforced'),
  settingRow(leagueLobbyScope, 'audience.posting', {
    responsible_adults: 'at_once',
    competitors: 'at_once',
    participants: 'at_once',
    link: 'never',
    public: 'never',
  }),
  settingRow(leagueLobbyScope, 'room.own_format', { value: 'off' }),
  settingRow(
    leagueLobbyScope,
    'resolution.rule',
    {
      method: 'strike',
      drawSize: 5,
      strikeWindowMs: 120_000,
      firstStriker: 0,
    },
    'enforced',
  ),
  settingRow(leagueLobbyScope, 'standings.rating_ladder', {
    ladderId: sampleLadderId,
  }),
];

const scopeNames: Readonly<Record<string, string>> = {
  [sampleIds.league]: LEAGUE_NAME,
  [sampleIds.leagueLobby]: LEAGUE_NAME,
  [sampleIds.varsityTemplate]: 'the Varsity debate template',
  [sampleIds.autumn]: 'Autumn Open',
  [sampleId('varsitydebate')]: 'Varsity debate',
};
/** Each sample scope's name, as a view names a source. */
export const sampleScopeName = (scope: SettingScope): string =>
  own(scopeNames, scope.id) ?? scope.id;

/** The league's Varsity template as its owner reads it. */
export const sampleVarsityTemplate: TemplateView = {
  templateId: sampleIds.varsityTemplate,
  name: 'Varsity debate',
  organization: { organizationId: sampleIds.league, name: LEAGUE_NAME },
  format: {
    formatId: sampleId('formatoneonone'),
    formatVersion: 3,
    name: 'One-on-one, limited prep',
  },
  ballotDefinition: {
    ballotDefinitionId: sampleId('ballotleague'),
    ballotDefinitionVersion: 2,
    name: '20 to 30 in halves, no low-point wins',
  },
  retiredAt: null,
  settings: leagueRows
    .filter((row) => row.scope.id === sampleIds.varsityTemplate)
    .map(({ key, value, hold }) => ({ key, value, hold })),
  capabilities: { manage: true },
};

/** The league as its owner reads it. */
export const sampleLeagueView: Extract<OrganizationView, { audience: 'host' }> =
  {
    audience: 'host',
    organizationId: sampleIds.league,
    handle: LEAGUE,
    name: LEAGUE_NAME,
    kind: 'league',
    standingLobby: {
      lobbyId: sampleIds.leagueLobby,
      handle: LEAGUE,
      name: LEAGUE_NAME,
    },
    schoolCount: 14,
    memberCount: 212,
    openRoomCount: 9,
    ratedCount: 148,
    capabilities: { manage: true },
  };

/** The league's standing lobby's settings, asked at the lobby by its owner. */
export const sampleLeagueLobbySettings = (): ResolvedSettingsView =>
  resolvedSettingsViewOf(
    {
      at: { kind: 'lobby', id: sampleIds.leagueLobby },
      chain: [leagueScope, leagueLobbyScope],
      rows: leagueRows,
      format: sampleFormatDefaults,
      scopeName: sampleScopeName,
      // The league's lobby page also shows what its Rooms count for, a key
      // the catalogue reads only on an event's chain.
      reads: 'every',
    },
    true,
  );

export const seasonRow = (
  place: number,
  name: string,
  school: string,
  points: number,
  you = false,
): SeasonRow => ({ place, name, school, points, you });

export const topOfSeason: readonly SeasonRow[] = [
  seasonRow(1, 'Jensen', 'Hartwell', 18),
  seasonRow(2, 'Castillo', 'Ridgeview', 15),
  seasonRow(3, 'Amari', 'Lakeside', 14),
];

const day = (startsAt: string) => ({ precision: 'day', startsAt }) as const;

export function sampleSeasonView(scene: SampleScene): SeasonView {
  return {
    seasonId: sampleId('season2026'),
    name: '2026 to 27 season',
    organization: { organizationId: sampleIds.league, name: LEAGUE_NAME },
    counting: 'sanction',
    calendar: [
      {
        lobbyId: sampleIds.opener,
        handle: 'september-opener',
        name: 'September Opener',
        when: day('2026-09-19T14:00:00.000Z'),
        completed: true,
        sanction: 'approved',
      },
      {
        lobbyId: sampleIds.autumn,
        handle: AUTUMN,
        name: 'Autumn Open',
        when: day('2026-11-14T15:00:00.000Z'),
        completed: reached(scene, 'finished'),
        sanction: 'approved',
      },
      {
        lobbyId: sampleIds.ridgeview,
        handle: 'ridgeview-invitational',
        name: 'Ridgeview Invitational',
        when: day('2026-11-28T15:00:00.000Z'),
        completed: false,
        sanction: 'requested',
      },
      {
        lobbyId: sampleIds.winter,
        handle: WINTER,
        name: 'Winter Classic',
        when: day('2026-12-12T14:00:00.000Z'),
        completed: false,
        sanction: 'approved',
      },
      {
        lobbyId: sampleIds.championship,
        handle: 'championship',
        name: 'Championship',
        when: { precision: 'month', month: '2027-03' },
        completed: false,
        sanction: 'approved',
      },
    ],
    standings: {
      series: { templateId: sampleIds.varsityTemplate, name: 'Varsity' },
      certifiedCount: 1,
      awaitingCertification: [
        { lobbyId: sampleIds.autumn, name: 'Autumn Open' },
      ],
      rows: topOfSeason.map((row) => ({
        place: row.place,
        entrant: row.name,
        school: row.school,
        points: row.points,
        viewer: row.you,
      })),
    },
  };
}

export const sampleSanctionList: SanctionList = {
  organizationId: sampleIds.league,
  sanctions: [
    {
      sanctionId: sampleId('sanctionridgeview'),
      status: 'requested',
      event: { eventId: sampleId('ridgeviewvarsity'), name: 'Varsity debate' },
      lobby: {
        lobbyId: sampleIds.ridgeview,
        name: 'Ridgeview Invitational',
        startsAt: '2026-11-28T15:00:00.000Z',
      },
      host: { organizationId: sampleIds.ridgeviewSchool, name: 'Ridgeview' },
      season: { seasonId: sampleId('season2026'), name: '2026 to 27 season' },
      template: {
        templateId: sampleIds.varsityTemplate,
        name: 'Varsity debate',
      },
      follows: true,
      mismatches: [],
    },
  ],
  capabilities: { decide: true },
};
/** The words the host league page uses for the sample's values. */
export const sampleHostLeagueCopy: HostLeagueCopy = {
  template: {
    rows: [
      {
        keys: ['standings.tiebreaks'],
        label: 'Tiebreaks',
        value: "Wins, speaker points, opponents' wins, rating",
      },
      {
        keys: ['pairing.preset'],
        label: 'Pairing',
        value: 'By record, no rematch',
      },
      {
        keys: ['recording.capture', 'audience.video'],
        label: 'Recording',
        value: 'Recorded · video for the people in each round',
      },
    ],
    note: 'anyone can copy it; an event that follows it can be sanctioned',
  },
  lobby: [
    {
      keys: ['audience.posting'],
      label: 'Who can join',
      value: 'Members of the 14 schools, and families the league has added',
    },
    {
      keys: ['room.own_format', 'resolution.rule'],
      label: 'Rooms members can open',
      value:
        "From the league's templates · resolution drawn from November's pool of 30 · members may judge each other",
    },
    {
      keys: ['standings.rating_ladder'],
      label: 'Lobby rooms count for',
      value: 'The league ladder · not season standings',
    },
  ],
};
