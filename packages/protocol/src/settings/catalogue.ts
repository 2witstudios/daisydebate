import { z } from 'zod';
import { forceKeys, type Force, type ForceKey } from './force';
import {
  settingKeySchema,
  settingValueSchemas,
  type SettingKey,
  type SettingValues,
} from './setting-values';

/** Where a setting is set. There is no stage scope. */
export const settingScopeKinds = [
  'organization',
  'template',
  'lobby',
  'event',
] as const;
export const settingScopeKindSchema = z.enum(settingScopeKinds);
export type SettingScopeKind = z.infer<typeof settingScopeKindSchema>;

/** Who may change a value below: `default` lets them, `enforced` does not. */
export const settingHoldSchema = z.enum(['default', 'enforced']);
export type SettingHold = z.infer<typeof settingHoldSchema>;

/**
 * Where a key's value comes from when no row in the chain sets it: Daisy's
 * value, the resolved pairing preset, or the pinned format.
 */
type SettingDefault<Key extends SettingKey> =
  | { readonly kind: 'value'; readonly value: SettingValues[Key] }
  | { readonly kind: 'preset' }
  | { readonly kind: 'format' };

export type SettingDefinition<Key extends SettingKey = SettingKey> = {
  readonly key: Key;
  readonly value: (typeof settingValueSchemas)[Key];
  /** The scopes the key may be set at. */
  readonly scopes: readonly SettingScopeKind[];
  readonly default: SettingDefault<Key>;
  /** Whether a scope above the event may hold the value `enforced`. */
  readonly enforceable: boolean;
  /** The forces the value accepts; null when it carries none. */
  readonly forces: readonly Force[] | null;
  /** The chain that reads it: an event's, a standing-lobby Room's, or both. */
  readonly chains: 'event' | 'room' | 'both';
};

type Row<Key extends SettingKey> = Pick<
  SettingDefinition<Key>,
  'scopes' | 'default' | 'chains'
> & { readonly enforceable?: false };

const everywhere = ['organization', 'template', 'lobby', 'event'] as const;
const aboveEvents = ['organization', 'template', 'lobby'] as const;
/** Only an organization sets a pairing, bye or judging policy key by key. */
const organizationOrTemplate = ['organization', 'template'] as const;
const preset = {
  scopes: organizationOrTemplate,
  default: { kind: 'preset' },
  chains: 'event',
} as const;
const daisy = <Key extends SettingKey>(
  scopes: readonly SettingScopeKind[],
  value: SettingValues[Key],
  chains: Row<Key>['chains'] = 'event',
): Row<Key> => ({ scopes, default: { kind: 'value', value }, chains });
const policy = <Key extends SettingKey>(value: SettingValues[Key]) =>
  daisy<Key>(organizationOrTemplate, value);
const majority = { size: 1, decision: 'majority' } as const;
const never = { link: 'never', public: 'never' } as const;

const rows: { readonly [Key in SettingKey]: Row<Key> } = {
  'pairing.preset': daisy(everywhere, { value: 'swiss_power' }),
  'pairing.method': preset,
  'pairing.section_size': preset,
  'pairing.rematch': preset,
  'pairing.same_school': preset,
  'pairing.side_balance': preset,
  'pairing.side_alternation': preset,
  'pairing.pull_up': preset,
  'pairing.position_balance': preset,
  'pairing.section_repeat': preset,
  'pairing.preference_order': preset,
  'bye.recipient': preset,
  'bye.result': preset,
  'bye.repeat': preset,
  'judging.panel': daisy(everywhere, {
    preliminary: majority,
    elimination: { ...majority, size: 3 },
  }),
  'judging.availability': policy({ force: 'rule' }),
  'judging.strike': policy({ force: 'rule' }),
  'judging.conflict': policy({ force: 'rule' }),
  'judging.same_school': policy({ force: 'rule' }),
  'judging.repeat_judge': policy({ force: 'preference' }),
  'judging.unsubmitted_ballot': policy({ force: 'warning' }),
  'judging.load_balance': policy({ force: 'preference' }),
  'judging.chair': policy({ force: 'preference' }),
  'judging.panel_same_school': policy({ force: 'preference' }),
  'judging.preference_order': policy({
    order: [
      'judging.repeat_judge',
      'judging.chair',
      'judging.panel_same_school',
      'judging.load_balance',
      'judging.availability',
      'judging.strike',
      'judging.conflict',
      'judging.same_school',
      'judging.unsubmitted_ballot',
    ],
  }),
  'standings.tiebreaks': daisy(everywhere, {
    metrics: ['wins', 'total_points', 'opponent_wins'],
    minimumGames: null,
    terminal: 'lot',
  }),
  'standings.rating_ladder': daisy(everywhere, { ladderId: null }),
  'break.line': daisy(everywhere, {
    default: { kind: 'fixed', size: 8 },
    byDivision: {},
  }),
  'break.seeding': daisy(everywhere, { value: 'standings' }),
  'break.double_qualifier': daisy(everywhere, { value: 'higher' }),
  'entry.divisions': daisy(everywhere, { items: [] }),
  'entry.registration': {
    ...daisy<'entry.registration'>(['lobby', 'event'], { state: 'closed' }),
    enforceable: false,
  },
  'entry.approval': daisy(everywhere, { value: 'host' }),
  'entry.cap': daisy(everywhere, { perEvent: null, perSchool: null }),
  'conflict.handling': daisy(aboveEvents, { value: 'second_confirms' }),
  'recording.capture': daisy(aboveEvents, { value: 'on' }),
  'audience.posting': daisy(
    everywhere,
    {
      responsible_adults: 'at_once',
      competitors: 'at_once',
      participants: 'at_once',
      ...never,
    },
    'both',
  ),
  'audience.decision': daisy(everywhere, {
    responsible_adults: 'round_close',
    competitors: 'round_close',
    participants: 'break',
    link: 'break',
    public: 'break',
  }),
  'audience.scores': daisy(everywhere, {
    responsible_adults: 'round_close',
    competitors: 'prelims_end',
    participants: 'never',
    ...never,
  }),
  'audience.reason': daisy(everywhere, {
    responsible_adults: 'round_close',
    competitors: 'prelims_end',
    participants: 'never',
    ...never,
  }),
  'audience.feedback': daisy(everywhere, {
    responsible_adults: 'round_close',
    competitors: 'prelims_end',
    participants: 'never',
    ...never,
  }),
  'audience.video': daisy(everywhere, {
    responsible_adults: 'prelims_end',
    competitors: 'prelims_end',
    participants: 'never',
    ...never,
  }),
  'ballot.screening': daisy(everywhere, { value: 'hold' }),
  'resolution.rule': daisy(
    everywhere,
    { method: 'fixed', release: 'with_posting' },
    'both',
  ),
  'resolution.own_text': daisy(
    ['organization', 'lobby'],
    { value: 'allowed' },
    'room',
  ),
  'room.own_format': daisy(
    ['organization', 'lobby'],
    { value: 'allowed' },
    'room',
  ),
  'room.visibility': daisy(aboveEvents, { value: 'public' }, 'room'),
  'room.timing': {
    scopes: everywhere,
    default: { kind: 'format' },
    chains: 'both',
  },
  'room.floor': {
    scopes: everywhere,
    default: { kind: 'format' },
    chains: 'both',
  },
  'staff.minimum_band': {
    ...daisy<'staff.minimum_band'>(
      ['organization'],
      { value: 'adult' },
      'both',
    ),
    enforceable: false,
  },
};

const define = <Key extends SettingKey>(key: Key): SettingDefinition<Key> => ({
  key,
  value: settingValueSchemas[key],
  scopes: rows[key].scopes,
  default: rows[key].default,
  chains: rows[key].chains,
  enforceable: rows[key].enforceable ?? true,
  forces: key in forceKeys ? forceKeys[key as ForceKey] : null,
});
/**
 * The settings catalogue: every configurable thing is one of these keys,
 * with its value schema, the scopes it may be set at, Daisy's default and
 * whether it may be enforced.
 */
export const settingsCatalogue = Object.fromEntries(
  settingKeySchema.options.map((key) => [key, define(key)]),
) as { readonly [Key in SettingKey]: SettingDefinition<Key> };

const scope = z.strictObject({
  kind: settingScopeKindSchema,
  id: z.string().min(1),
});
export type SettingScope = z.infer<typeof scope>;

/**
 * A setting as stored: a catalogue key with a value, set at a scope, with a
 * hold. The value fits the key, the scope is one the key allows, and
 * `enforced` is accepted only above the event, for a key that may be.
 */
export const settingRowSchema = z
  .strictObject({
    scope,
    key: settingKeySchema,
    value: z.unknown(),
    hold: settingHoldSchema,
  })
  .superRefine((row, context) => {
    const definition: SettingDefinition = settingsCatalogue[row.key];
    const parsed = definition.value.safeParse(row.value);
    for (const issue of parsed.success ? [] : parsed.error.issues)
      context.addIssue({
        code: 'custom',
        message: issue.message,
        path: ['value', ...issue.path],
      });
    if (!definition.scopes.includes(row.scope.kind))
      context.addIssue({
        code: 'custom',
        message: 'The key is not set at this scope.',
        path: ['scope', 'kind'],
      });
    if (
      row.hold === 'enforced' &&
      (!definition.enforceable || row.scope.kind === 'event')
    )
      context.addIssue({
        code: 'custom',
        message: 'The value may not be enforced here.',
        path: ['hold'],
      });
  });
export type SettingRow<Key extends SettingKey = SettingKey> = {
  readonly scope: SettingScope;
  readonly key: Key;
  readonly value: SettingValues[Key];
  readonly hold: SettingHold;
};
