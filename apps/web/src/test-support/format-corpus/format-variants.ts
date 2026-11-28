import {
  casualTemplateIds,
  catalogFormats,
  type CatalogFormat,
} from '@daisy/db/catalog-formats';
import { resolveRoomConfiguration } from '@daisy/debate-engine';
import {
  parliamentaryPointsOfInformation,
  type FormatSettings,
} from '@daisy/protocol/format-settings';
import type { RoundRules } from '@daisy/protocol/format';

/** One catalog format with points of information off, or on at the parliamentary defaults. */
export type FormatVariant = {
  readonly format: CatalogFormat;
  /** `off`, `poi`, or `preset` when the format takes no points of information. */
  readonly mode: string;
  readonly settings: FormatSettings;
};

const withPoints = (format: CatalogFormat, on: boolean): FormatVariant => ({
  format,
  mode: on ? 'poi' : 'off',
  settings: {
    ...format.preset,
    pointsOfInformation: on
      ? parliamentaryPointsOfInformation
      : { enabled: false },
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

/** Every corpus format with points of information off and on where it takes them, in catalog order. */
export const formatVariants = (): readonly FormatVariant[] =>
  corpusFormats.flatMap((format) =>
    format.definition.configurable.interaction.pointsOfInformation
      ? [withPoints(format, false), withPoints(format, true)]
      : [{ format, mode: 'preset', settings: format.preset }],
  );

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
