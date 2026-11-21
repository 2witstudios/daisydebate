import type { SettingRow, SettingScope } from '@daisy/protocol/settings';
import type { FormatSettingDefaults } from '@daisy/protocol/setting-resolution';
import type { SettingKey, SettingValues } from '@daisy/protocol/setting-values';
import { LEAGUE_NAME } from './moment';
import { own } from './own';
import { sampleId, sampleIds } from './organization';

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

const leagueScope: SettingScope = {
  kind: 'organization',
  id: sampleIds.league,
};
const varsityTemplateScope: SettingScope = {
  kind: 'template',
  id: sampleIds.varsityTemplate,
};
const leagueLobbyScope: SettingScope = {
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
const sampleLadderId = sampleId('leagueladder');

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
