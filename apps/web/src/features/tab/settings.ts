import type {
  ResolvedSettingEntry,
  ResolvedSettingSource,
} from '@daisy/protocol/lobby/resolved-settings-read';
import type { SettingHold } from '@daisy/protocol/settings';
import type { TabAction } from './action';

/**
 * Where a setting line says its value comes from: `daisy` is Daisy's own
 * default (the catalogue, a pairing preset or the pinned format), otherwise
 * the kind of scope that set it.
 */
export type SettingScope =
  'daisy' | 'organization' | 'template' | 'lobby' | 'event';

/**
 * What this person may do about a setting. A scope above that enforces the
 * value locks it; otherwise it is theirs to set, and `hold` is how firmly
 * their value binds the scopes below.
 */
export type SettingControl =
  | {
      readonly kind: 'locked';
      /** Where the whole of a locked value can be read, when it has a page. */
      readonly view: TabAction | null;
    }
  | {
      readonly kind: 'open';
      readonly hold: SettingHold;
      /** Null where the value has no editor of its own. */
      readonly edit: TabAction | null;
    };

/**
 * One setting line as every screen shows it: the screen's projection of one
 * or more entries of a resolved-settings view (or of a template's pin),
 * with the words the screen uses for it. Setup, a league's template, the
 * create-room form and an event Room's "set by" lines all render this.
 */
export type SettingLine = {
  /** The catalogue keys (or the template pin) this line shows. */
  readonly keys: readonly string[];
  readonly label: string;
  readonly value: string;
  readonly source: { readonly scope: SettingScope; readonly name: string };
  readonly control: SettingControl;
  /** Something the host still has to do about this setting. */
  readonly attention: string | null;
};

/**
 * The line's former name, kept while the ballot and standings screens move
 * to `SettingLine`; the resolved setting itself is the protocol's
 * `ResolvedSettingEntry`.
 */
export type ResolvedSetting = SettingLine;

export const lockedSetting: SettingControl = { kind: 'locked', view: null };

/** A locked setting whose whole value has a page of its own to read. */
export const lockedWithView = (view: TabAction): SettingControl => ({
  kind: 'locked',
  view,
});

/** A setting this person holds, as a default unless they enforce it below. */
export const openSetting = (
  edit: TabAction | null = null,
  hold: SettingHold = 'default',
): SettingControl => ({ kind: 'open', hold, edit });

/** How firmly a setting binds the scopes below the one that holds it. */
export const holdLabel = (setting: SettingLine): string =>
  setting.control.kind === 'locked' || setting.control.hold === 'enforced'
    ? 'Enforced'
    : 'Default';

export const sourceLabel = (setting: SettingLine): string => {
  switch (setting.source.scope) {
    case 'daisy':
      return "Daisy's default";
    case 'organization':
      return `set by ${setting.source.name}`;
    case 'template':
      return `from ${setting.source.name}`;
    case 'lobby':
    case 'event':
      return `set for ${setting.source.name}`;
  }
};

/** The line's source: the named scope, or Daisy for a default of any kind. */
export const lineSourceOf = (
  source: ResolvedSettingSource,
): SettingLine['source'] => {
  switch (source.kind) {
    case 'catalogue':
    case 'preset':
    case 'format':
      return { scope: 'daisy', name: 'Daisy' };
    case 'organization':
    case 'template':
    case 'lobby':
    case 'event':
      return { scope: source.kind, name: source.name };
  }
};

/** What a screen says about one line, beyond what the view resolves. */
export type SettingLineCopy = {
  readonly keys: readonly string[];
  readonly label: string;
  /** The value as this screen words it. */
  readonly value: string;
  /** The way to change it, where the person may. */
  readonly edit?: TabAction | null;
  /** Where a locked value can be read whole. */
  readonly view?: TabAction | null;
  readonly attention?: string | null;
};

/**
 * One line from the view entry it shows. Enforced above, or not the
 * person's to set, locks it; a key set only at another kind of scope stays
 * open, because the screens that show one edit it where it is set.
 */
export function settingLineOf(
  entry: ResolvedSettingEntry,
  copy: SettingLineCopy,
): SettingLine {
  const locked =
    entry.locked === 'enforced' || entry.locked === 'not-permitted';
  const view = copy.view ?? null;
  return {
    keys: copy.keys,
    label: copy.label,
    value: copy.value,
    source: lineSourceOf(entry.source),
    control: locked
      ? view === null
        ? lockedSetting
        : lockedWithView(view)
      : openSetting(copy.edit ?? null, entry.own?.hold ?? 'default'),
    attention: copy.attention ?? null,
  };
}
