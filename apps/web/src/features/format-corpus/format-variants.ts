import {
  casualTemplateIds,
  catalogFormats,
  type CatalogFormat,
} from '@daisy/db/catalog-formats';
import { resolveRoomConfiguration } from '@daisy/debate-engine';
import type { FormatSettings, RoundRules } from '@daisy/protocol';

/** One catalog format under one interruption choice its definition permits. */
export type FormatVariant = {
  readonly format: CatalogFormat;
  /** The interruption mode chosen, or `preset` when the format forbids interruptions. */
  readonly mode: string;
  readonly settings: FormatSettings;
};

const withMode = (
  format: CatalogFormat,
  mode: NonNullable<FormatSettings['interruptions']>['mode'],
): FormatVariant => ({
  format,
  mode,
  settings: {
    ...format.preset,
    interruptions: {
      mode,
      minRemainingMs:
        format.preset.interruptions?.minRemainingMs ??
        format.definition.configurable.interaction.interruptions?.minRemainingMs
          .min ??
        0,
    },
  },
});

/**
 * The catalog the two-sided corpus captured (TAB-6.1): every format but
 * Daisy's casual templates, which came after it and whose proofs are their
 * own integration suites (TAB-6.18).
 */
export const corpusFormats: readonly CatalogFormat[] = catalogFormats.filter(
  ({ id }) => !casualTemplateIds.includes(id),
);

/** Every corpus format crossed with each interruption mode it permits, in catalog order. */
export const formatVariants = (): readonly FormatVariant[] =>
  corpusFormats.flatMap((format) => {
    const modes =
      format.definition.configurable.interaction.interruptions?.modes;
    return modes
      ? modes.map((mode) => withMode(format, mode))
      : [{ format, mode: 'preset', settings: format.preset }];
  });

/** The compiled rules for a variant; throws when the compiler refuses it. */
export const rulesOf = (variant: FormatVariant): RoundRules => {
  const outcome = resolveRoomConfiguration(
    variant.format.definition,
    variant.settings,
  );
  if (!outcome.ok) throw new Error(outcome.refusal.message);
  return outcome.rules;
};

/** The compiler's whole answer for a variant, refusal included. */
export const resolvedVariant = (variant: FormatVariant) => ({
  formatId: variant.format.id,
  mode: variant.mode,
  settings: variant.settings,
  outcome: resolveRoomConfiguration(
    variant.format.definition,
    variant.settings,
  ),
});
