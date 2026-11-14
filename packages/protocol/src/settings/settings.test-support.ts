import type { SettingRow, SettingScope } from './catalogue';
import { pairingForceKeys } from './force';
import type { FormatSettingDefaults } from './resolve-setting';
import type { SettingKey, SettingValues } from './setting-values';

/** What a pinned format gives the keys that default to it. */
export const formatDefaults: FormatSettingDefaults = {
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

const open = {
  responsible_adults: 'at_once',
  competitors: 'at_once',
  participants: 'at_once',
  link: 'never',
  public: 'never',
} as const;
/** A valid value for every key that no default and no preset gives it. */
export const otherValues: SettingValues = {
  'pairing.preset': { value: 'round_robin' },
  'pairing.method': {
    preliminary: {
      structure: 'powered',
      first: 'seeded',
      later: 'slide',
      lag: 1,
    },
    elimination: { structure: 'seeded' },
  },
  'pairing.section_size': { target: 5 },
  'pairing.rematch': { force: 'warning' },
  'pairing.same_school': { force: 'rule' },
  'pairing.side_balance': { force: 'rule', maxImbalance: 2 },
  'pairing.side_alternation': { force: 'off' },
  'pairing.pull_up': {
    force: 'preference',
    choose: 'lowest_strength',
    maxRecordDistance: 2,
  },
  'pairing.position_balance': { force: 'off' },
  'pairing.section_repeat': { force: 'warning' },
  'pairing.preference_order': { order: [...pairingForceKeys].reverse() },
  'bye.recipient': { value: 'random' },
  'bye.result': { value: 'win' },
  'bye.repeat': { force: 'warning' },
  'judging.panel': {
    preliminary: { size: 3, decision: 'majority' },
    elimination: { size: 5, decision: 'rank_sum' },
  },
  'judging.availability': { force: 'warning' },
  'judging.strike': { force: 'preference' },
  'judging.conflict': { force: 'warning' },
  'judging.same_school': { force: 'warning' },
  'judging.repeat_judge': { force: 'rule' },
  'judging.unsubmitted_ballot': { force: 'rule' },
  'judging.load_balance': { force: 'off' },
  'judging.chair': { force: 'rule' },
  'judging.panel_same_school': { force: 'off' },
  'judging.preference_order': {
    order: [
      'judging.availability',
      'judging.strike',
      'judging.conflict',
      'judging.same_school',
      'judging.repeat_judge',
      'judging.unsubmitted_ballot',
      'judging.load_balance',
      'judging.chair',
      'judging.panel_same_school',
    ],
  },
  'standings.tiebreaks': {
    metrics: ['wins', 'rating'],
    minimumGames: 3,
    terminal: 'shared',
  },
  'standings.rating_ladder': { ladderId: 'a'.repeat(24) },
  'break.line': {
    default: { kind: 'record', wins: 4 },
    byDivision: { novice: { kind: 'tie_inclusive', size: 4, ceiling: 6 } },
  },
  'break.seeding': { value: 'rating' },
  'break.double_qualifier': { value: 'choice' },
  'entry.divisions': {
    items: [
      {
        key: 'novice',
        label: 'Novice',
        eligibility: { kind: 'prior_entries_at_most', count: 2 },
      },
      { key: 'open', label: 'Open', eligibility: { kind: 'open' } },
    ],
  },
  'entry.registration': {
    state: 'window',
    opensAt: '2026-11-13T12:00:00.000Z',
    closesAt: '2026-11-20T12:00:00.000Z',
  },
  'entry.approval': { value: 'automatic' },
  'entry.cap': { perEvent: 64, perSchool: 4 },
  'conflict.handling': { value: 'denied' },
  'recording.capture': { value: 'off' },
  'audience.posting': { ...open, link: 'at_once', public: 'at_once' },
  'audience.decision': { ...open, link: 'certified', public: 'certified' },
  'audience.scores': open,
  'audience.reason': { ...open, participants: 'never' },
  'audience.feedback': {
    ...open,
    competitors: 'manual',
    participants: 'never',
  },
  'audience.video': {
    ...open,
    participants: 'break',
    link: 'manual',
    public: 'never',
  },
  'ballot.screening': { value: 'off' },
  'resolution.rule': {
    method: 'strike',
    drawSize: 3,
    strikeWindowMs: 60_000,
    firstStriker: 1,
  },
  'resolution.own_text': { value: 'off' },
  'room.own_format': { value: 'off' },
  'room.visibility': { value: 'unlisted' },
  'room.timing': {
    preRoundPrepMs: 600_000,
    inRoundPrepMsPerSide: 0,
    countdownMs: 0,
  },
  'room.floor': {
    interruptions: { mode: 'open', minRemainingMs: 15_000 },
    yielding: { allowed: true, returnsTime: true },
  },
  'staff.minimum_band': { value: '16-17' },
};

export const scope = (
  kind: SettingScope['kind'],
  id: string = kind,
): SettingScope => ({ kind, id });
export const row = <Key extends SettingKey>(
  at: SettingScope,
  key: Key,
  value: SettingValues[Key],
  hold: SettingRow['hold'] = 'default',
): SettingRow<Key> => ({ scope: at, key, value, hold });
