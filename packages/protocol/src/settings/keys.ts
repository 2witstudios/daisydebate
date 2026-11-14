/**
 * The closed list of setting keys (Daisy Tab architecture, section 4). A
 * setting is a key from this list with a JSON-object value, set at one scope
 * with a hold. `settings.key` is CHECKed against this array, so a new key is
 * a migration. This is the one list: the catalogue's value schemas must
 * cover exactly these keys, which the type checker holds.
 */
export const settingKeys = [
  'pairing.preset',
  'pairing.method',
  'pairing.section_size',
  'pairing.rematch',
  'pairing.same_school',
  'pairing.side_balance',
  'pairing.side_alternation',
  'pairing.pull_up',
  'pairing.position_balance',
  'pairing.section_repeat',
  'pairing.preference_order',
  'bye.recipient',
  'bye.result',
  'bye.repeat',
  'judging.panel',
  'judging.availability',
  'judging.strike',
  'judging.conflict',
  'judging.same_school',
  'judging.repeat_judge',
  'judging.unsubmitted_ballot',
  'judging.load_balance',
  'judging.chair',
  'judging.panel_same_school',
  'judging.preference_order',
  'standings.tiebreaks',
  'standings.rating_ladder',
  'break.line',
  'break.seeding',
  'break.double_qualifier',
  'entry.divisions',
  'entry.registration',
  'entry.approval',
  'entry.cap',
  'conflict.handling',
  'recording.capture',
  'audience.posting',
  'audience.decision',
  'audience.scores',
  'audience.reason',
  'audience.feedback',
  'audience.video',
  'ballot.screening',
  'resolution.rule',
  'resolution.own_text',
  'room.own_format',
  'room.visibility',
  'room.timing',
  'room.floor',
  'staff.minimum_band',
] as const;
export type SettingKey = (typeof settingKeys)[number];

/** Where a setting is set, widest first. There is no stage scope. */
export const settingScopeKinds = [
  'organization',
  'template',
  'lobby',
  'event',
] as const;
export type SettingScopeKind = (typeof settingScopeKinds)[number];

/** Who below may change a setting: `default` they may, `enforced` they may not. */
export const settingHolds = ['default', 'enforced'] as const;
export type SettingHold = (typeof settingHolds)[number];
