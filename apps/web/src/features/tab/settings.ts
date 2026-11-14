import type { TabAction } from './action';

/** The scope a resolved value comes from; `daisy` is the catalogue default. */
export type SettingScope =
  'daisy' | 'organization' | 'template' | 'lobby' | 'event';

/**
 * One setting as every screen shows it: the resolved value, where it comes
 * from, and whether it is locked for this person because a scope above
 * enforces it. Setup, a league's template, the create-room form and an event
 * Room's "set by" lines all render this one shape.
 */
export type ResolvedSetting = {
  /** The catalogue keys this line resolves, e.g. `standings.tiebreaks`. */
  readonly keys: readonly string[];
  readonly label: string;
  readonly value: string;
  readonly source: { readonly scope: SettingScope; readonly name: string };
  readonly hold: 'default' | 'enforced';
  readonly locked: boolean;
  /** Something the host still has to do about this setting. */
  readonly attention: string | null;
  /** Null when locked, or when the value has no editor of its own. */
  readonly edit: TabAction | null;
};

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
