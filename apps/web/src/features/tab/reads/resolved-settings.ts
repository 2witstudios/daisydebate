import type {
  ResolvedSettingEntry,
  ResolvedSettingSource,
  ResolvedSettingsView,
  SettingKeyFamily,
  SettingLock,
  SettingsAt,
} from '@daisy/protocol/lobby/resolved-settings-read';
import { settingKeyFamilyOf } from '@daisy/protocol/lobby/resolved-settings-read';
import {
  settingsCatalogue,
  type SettingRow,
  type SettingScope,
} from '@daisy/protocol/settings';
import {
  resolveSetting,
  type FormatSettingDefaults,
  type SettingChain,
  type SettingSource,
} from '@daisy/protocol/setting-resolution';
import { settingKeySchema, type SettingKey } from '@daisy/protocol/setting-values';

/**
 * What one resolved-settings view is built from: where it was asked, the
 * chain that place reads (highest first, ending at the scope asked about,
 * or at the lobby for a Room being drafted), every row in that chain, the
 * pinned format's values, each scope's name, and which chain's keys apply
 * there (`every` at an organization or a template, which serve both).
 */
export type ResolvedSettingsFacts = {
  readonly at: SettingsAt;
  readonly chain: SettingChain;
  readonly rows: readonly SettingRow[];
  readonly format: FormatSettingDefaults;
  readonly scopeName: (scope: SettingScope) => string;
  readonly reads: 'event' | 'room' | 'every';
  readonly family?: SettingKeyFamily;
};

const sourceOf = (
  source: SettingSource,
  scopeName: ResolvedSettingsFacts['scopeName'],
): ResolvedSettingSource => {
  switch (source.kind) {
    case 'catalogue':
    case 'format':
      return { kind: source.kind };
    case 'preset':
      return { kind: 'preset', preset: source.preset };
    case 'organization':
    case 'template':
    case 'lobby':
    case 'event':
      return { kind: source.kind, id: source.id, name: scopeName(source) };
  }
};

const askedScope = (at: SettingsAt): SettingScope | null =>
  at.kind === 'room_draft' ? null : { kind: at.kind, id: at.id };

const sameScope = (a: SettingScope, b: SettingScope) =>
  a.kind === b.kind && a.id === b.id;

const applies = (key: SettingKey, reads: ResolvedSettingsFacts['reads']) => {
  const chains = settingsCatalogue[key].chains;
  return reads === 'every' || chains === 'both' || chains === reads;
};

/**
 * Whether the caller may set the key where they asked: not where a scope
 * above enforces it, not at a kind of scope the key is never set at, not
 * without the permission. A Room being drafted takes every value a scope
 * does not enforce.
 */
function lockOf(
  key: SettingKey,
  asked: SettingScope | null,
  resolved: { readonly hold: string; readonly source: SettingSource },
  mayChange: boolean,
): SettingLock | null {
  const enforcedAbove =
    resolved.hold === 'enforced' &&
    'id' in resolved.source &&
    (asked === null || !sameScope(resolved.source, asked));
  if (enforcedAbove) return 'enforced';
  if (asked !== null && !settingsCatalogue[key].scopes.includes(asked.kind))
    return 'scope';
  return mayChange ? null : 'not-permitted';
}

/**
 * The resolved-settings view of one place, built from the one resolver: per
 * key its value, source (a scope with its name), hold, the row at the scope
 * asked about, and whether the caller (`mayChange`: the setting command's
 * gate allows them there) may change it.
 */
export function resolvedSettingsViewOf(
  facts: ResolvedSettingsFacts,
  mayChange: boolean,
): ResolvedSettingsView {
  const asked = askedScope(facts.at);
  const settings = settingKeySchema.options
    .filter((key) => applies(key, facts.reads))
    .filter(
      (key) =>
        facts.family === undefined || settingKeyFamilyOf(key) === facts.family,
    )
    .map((key): ResolvedSettingEntry => {
      const resolved = resolveSetting(key, facts.chain, facts.rows, facts.format);
      const own =
        asked === null
          ? undefined
          : facts.rows.find(
              (row) => row.key === key && sameScope(row.scope, asked),
            );
      return {
        key,
        value: resolved.value,
        source: sourceOf(resolved.source, facts.scopeName),
        hold: resolved.hold,
        own: own ? { value: own.value, hold: own.hold } : null,
        locked: lockOf(key, asked, resolved, mayChange),
      };
    });
  return { at: facts.at, settings };
}

/** One key's entry in a view, or null when the view does not carry it. */
export const resolvedEntry = (
  view: ResolvedSettingsView,
  key: SettingKey,
): ResolvedSettingEntry | null =>
  view.settings.find((entry) => entry.key === key) ?? null;
