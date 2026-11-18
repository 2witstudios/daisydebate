import { sameSettingValue } from './resolve-setting';
import type { SettingKey, SettingValues } from './setting-values';

/** What a sanction compares on each side: the pinned format and ballot definition. */
type Pins = {
  readonly formatVersionId: string;
  readonly ballotDefinitionVersionId: string;
};
export type SanctionMismatch = 'format' | 'ballot_definition' | SettingKey;
export type SanctionCheck =
  | { readonly passes: true }
  | {
      readonly passes: false;
      readonly mismatches: readonly SanctionMismatch[];
    };

/**
 * A league may sanction an event only when the event has the template's
 * format and ballot definition and, for every value the template enforces,
 * the event's resolved value equals it. An event that follows the template
 * passes by construction. Computed on demand; nothing about it is stored.
 */
export function sanctionCheck(
  template: Pins & {
    /** The values the template's chain enforces. */
    readonly enforced: readonly {
      readonly key: SettingKey;
      readonly value: unknown;
    }[];
  },
  event: Pins & {
    readonly resolved: {
      readonly [Key in SettingKey]: { readonly value: SettingValues[Key] };
    };
  },
): SanctionCheck {
  const mismatches: readonly SanctionMismatch[] = [
    ...(template.formatVersionId === event.formatVersionId
      ? []
      : (['format'] as const)),
    ...(template.ballotDefinitionVersionId === event.ballotDefinitionVersionId
      ? []
      : (['ballot_definition'] as const)),
    ...template.enforced
      .filter(
        (row) => !sameSettingValue(row.value, event.resolved[row.key].value),
      )
      .map((row) => row.key),
  ];
  return mismatches.length === 0
    ? { passes: true }
    : { passes: false, mismatches };
}
