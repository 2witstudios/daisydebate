import type { TabAction } from './action';

/** The scope a resolved value comes from; `daisy` is the catalogue default. */
export type SettingScope =
  'daisy' | 'organization' | 'template' | 'lobby' | 'event';

/**
 * What this person may do about a setting. A scope above that enforces the
 * value locks it; otherwise it is theirs to set, and `hold` is how firmly
 * their value binds the scopes below.
 */
export type SettingControl =
  | { readonly kind: 'locked' }
  | {
      readonly kind: 'open';
      readonly hold: 'default' | 'enforced';
      /** Null where the value has no editor of its own. */
      readonly edit: TabAction | null;
    };

/**
 * One setting as every screen shows it: the resolved value, where it comes
 * from, and what this person may do about it. Setup, a league's template, the
 * create-room form and an event Room's "set by" lines all render this one
 * shape.
 */
export type ResolvedSetting = {
  /** The catalogue keys this line resolves, e.g. `standings.tiebreaks`. */
  readonly keys: readonly string[];
  readonly label: string;
  readonly value: string;
  readonly source: { readonly scope: SettingScope; readonly name: string };
  readonly control: SettingControl;
  /** Something the host still has to do about this setting. */
  readonly attention: string | null;
};

export const lockedSetting: SettingControl = { kind: 'locked' };

/** A setting this person holds, as a default unless they enforce it below. */
export const openSetting = (
  edit: TabAction | null = null,
  hold: 'default' | 'enforced' = 'default',
): SettingControl => ({ kind: 'open', hold, edit });

/** How firmly a setting binds the scopes below the one that holds it. */
export const holdLabel = (setting: ResolvedSetting): string =>
  setting.control.kind === 'locked' || setting.control.hold === 'enforced'
    ? 'Enforced'
    : 'Default';

export const sourceLabel = (setting: ResolvedSetting): string => {
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
