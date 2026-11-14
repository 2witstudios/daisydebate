import {
  settingsCatalogue,
  type SettingHold,
  type SettingRow,
  type SettingScope,
} from './catalogue';
import { pairingPresets, type PresetKey } from './pairing-presets';
import {
  settingKeySchema,
  type PairingPresetName,
  type SettingKey,
  type SettingValues,
} from './setting-values';

/**
 * The scopes one event or Room reads its settings from, highest first.
 * Order above the lowest scope never matters, because enforced values in
 * one chain agree.
 */
export type SettingChain = readonly SettingScope[];

const distinct = (scopes: readonly SettingScope[]): SettingChain =>
  scopes.filter(
    (scope, index) =>
      scopes.findIndex((other) => sameScope(other, scope)) === index,
  );
/**
 * An event's chain: the organization that owns the template it follows, the
 * template, the league that owns the tournament if one does, the tournament,
 * the event.
 */
export const eventChain = (event: {
  readonly template: {
    readonly id: string;
    readonly organizationId: string;
  } | null;
  readonly leagueId: string | null;
  readonly lobbyId: string;
  readonly eventId: string;
}): SettingChain =>
  distinct([
    ...(event.template
      ? [
          { kind: 'organization' as const, id: event.template.organizationId },
          { kind: 'template' as const, id: event.template.id },
        ]
      : []),
    ...(event.leagueId
      ? [{ kind: 'organization' as const, id: event.leagueId }]
      : []),
    { kind: 'lobby', id: event.lobbyId },
    { kind: 'event', id: event.eventId },
  ]);
/**
 * The chain of a Room in a standing lobby: the organization, the template
 * the Room follows if it follows one, the lobby.
 */
export const roomChain = (room: {
  readonly organizationId: string;
  readonly templateId: string | null;
  readonly lobbyId: string;
}): SettingChain => [
  { kind: 'organization', id: room.organizationId },
  ...(room.templateId
    ? [{ kind: 'template' as const, id: room.templateId }]
    : []),
  { kind: 'lobby', id: room.lobbyId },
];

/** The values the pinned format gives the keys that default to it. */
export type FormatSettingDefaults = Pick<
  SettingValues,
  'room.timing' | 'room.floor'
>;

export type SettingSource =
  | { readonly kind: 'catalogue' }
  | { readonly kind: 'preset'; readonly preset: PairingPresetName }
  | { readonly kind: 'format' }
  | SettingScope;
export type ResolvedSetting<Key extends SettingKey = SettingKey> = {
  readonly key: Key;
  readonly value: SettingValues[Key];
  readonly hold: SettingHold;
  /** Where the value came from. */
  readonly source: SettingSource;
};

const sameScope = (a: SettingScope, b: SettingScope): boolean =>
  a.kind === b.kind && a.id === b.id;
/** The chain's rows for one key, highest first. */
const rowsFor = <Key extends SettingKey>(
  key: Key,
  chain: SettingChain,
  rows: readonly SettingRow[],
): readonly SettingRow<Key>[] =>
  chain.flatMap((scope) =>
    rows.filter(
      (row): row is SettingRow<Key> =>
        row.key === key && sameScope(row.scope, scope),
    ),
  );

function fallback<Key extends SettingKey>(
  key: Key,
  chain: SettingChain,
  rows: readonly SettingRow[],
  format: FormatSettingDefaults,
): Pick<ResolvedSetting<Key>, 'value' | 'source'> {
  const byDefault = settingsCatalogue[key].default;
  if (byDefault.kind === 'value')
    return { value: byDefault.value, source: { kind: 'catalogue' } };
  if (byDefault.kind === 'format')
    return {
      value: format[key as keyof FormatSettingDefaults] as SettingValues[Key],
      source: { kind: 'format' },
    };
  const preset = resolveSetting('pairing.preset', chain, rows, format).value
    .value;
  return {
    value: pairingPresets[preset][key as PresetKey] as SettingValues[Key],
    source: { kind: 'preset', preset },
  };
}

/**
 * The one resolution rule: an enforced value if the chain has one, otherwise
 * the lowest row, otherwise the key's default, which for a pairing or bye
 * key is what the resolved preset gives and for `room.timing` and
 * `room.floor` what the pinned format gives. Rows outside the chain are not
 * read.
 */
export function resolveSetting<Key extends SettingKey>(
  key: Key,
  chain: SettingChain,
  rows: readonly SettingRow[],
  format: FormatSettingDefaults,
): ResolvedSetting<Key> {
  const set = rowsFor(key, chain, rows);
  const row =
    set.find((candidate) => candidate.hold === 'enforced') ?? set.at(-1);
  return row
    ? { key, value: row.value, hold: row.hold, source: row.scope }
    : { key, hold: 'default', ...fallback(key, chain, rows, format) };
}

/** Every catalogue key resolved for one chain. */
export const resolveSettings = (
  chain: SettingChain,
  rows: readonly SettingRow[],
  format: FormatSettingDefaults,
) =>
  Object.fromEntries(
    settingKeySchema.options.map((key) => [
      key,
      resolveSetting(key, chain, rows, format),
    ]),
  ) as { readonly [Key in SettingKey]: ResolvedSetting<Key> };

const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([name, inner]) => [name, canonical(inner)]),
  );
};
/** Whether two setting values are the same JSON, whatever their key order. */
export const sameSettingValue = (a: unknown, b: unknown): boolean =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/** Two scopes in one chain enforcing different values for one key. */
export type EnforcedConflict = {
  readonly key: SettingKey;
  readonly scopes: readonly [SettingScope, SettingScope];
};
/**
 * Enforced values never disagree: the first pair of scopes in the chain that
 * enforce different values for the key, or null when they agree. A command
 * that would leave one is refused, naming the key and both scopes.
 */
export function enforcedConflict(
  key: SettingKey,
  chain: SettingChain,
  rows: readonly SettingRow[],
): EnforcedConflict | null {
  const enforced = rowsFor(key, chain, rows).filter(
    (row) => row.hold === 'enforced',
  );
  const [first] = enforced;
  const other = enforced.find(
    (row) => first && !sameSettingValue(row.value, first.value),
  );
  return first && other ? { key, scopes: [first.scope, other.scope] } : null;
}

/** The rows after one is set: a scope holds one row per key. */
export const withSettingRow = (
  rows: readonly SettingRow[],
  row: SettingRow,
): readonly SettingRow[] => [
  ...withoutSettingRow(rows, row.scope, row.key),
  row,
];
/** The rows after one is cleared. */
export const withoutSettingRow = (
  rows: readonly SettingRow[],
  scope: SettingScope,
  key: SettingKey,
): readonly SettingRow[] =>
  rows.filter((row) => !(row.key === key && sameScope(row.scope, scope)));
