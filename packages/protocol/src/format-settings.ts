import { z } from 'zod';
import {
  MAX_PRE_ROUND_PREP_MS,
  pointsOfInformationTimingSchema,
} from './format';
import { formatResolutionDrawSchema } from './resolution-draw';

/**
 * "Available and declined" has exactly one spelling per level (ADR 0058):
 * a `null` capability in the definition means forbidden, so the settings
 * have nothing to spell; `{ enabled: false }` here means the capability
 * exists and these format settings decline it. `forbidden ≠
 * available-but-disabled`.
 */
const declinedSchema = z.strictObject({ enabled: z.literal(false) });

/** Pre-round prep: format structure, which the Room executes (ADR 0058). */
export const preRoundPrepSchema = z.discriminatedUnion('enabled', [
  declinedSchema,
  z.strictObject({
    enabled: z.literal(true),
    durationMs: z.int().positive().max(MAX_PRE_ROUND_PREP_MS),
  }),
]);

const inRoundPrepSchema = z.discriminatedUnion('enabled', [
  declinedSchema,
  z.strictObject({
    enabled: z.literal(true),
    budgetMsPerSide: z.int().min(0),
  }),
]);

/** Points of information: declined, or taken with these timings. */
const pointsOfInformationSettingSchema = z.discriminatedUnion('enabled', [
  declinedSchema,
  pointsOfInformationTimingSchema.extend({ enabled: z.literal(true) }),
]);
export type PointsOfInformationSetting = z.infer<
  typeof pointsOfInformationSettingSchema
>;

/**
 * The values a format sanctions within its definition: timing,
 * points of information, yielding and prep. A Room embeds them
 * and adds its own inputs (`roomConfigSchema`).
 */
export const formatSettingsFields = {
  preRoundPrep: preRoundPrepSchema,
  inRoundPrep: inRoundPrepSchema,
  speechTiming: z.strictObject({
    countdownMs: z.int().min(0),
    /** Partial: unspecified segments take the format's defaultDurationMs. */
    segmentDurationOverrides: z.record(z.string(), z.int().positive()),
  }),
  /** Null only when the format takes no points of information; otherwise an explicit legal choice. */
  pointsOfInformation: pointsOfInformationSettingSchema.nullable(),
  /** Null only when the format forbids yielding; otherwise an explicit legal choice. */
  yielding: z
    .strictObject({ allowed: z.boolean(), returnsTime: z.boolean() })
    .nullable(),
};

/**
 * A format preset's settings (ISSUE-775): Formats-owned, never the Room's
 * config. The draw policy names only Daisy's bank; a host-written list is a
 * Room's own input.
 */
export const formatSettingsSchema = z.strictObject({
  ...formatSettingsFields,
  resolutionDraw: formatResolutionDrawSchema,
});
export type FormatSettings = z.infer<typeof formatSettingsSchema>;
