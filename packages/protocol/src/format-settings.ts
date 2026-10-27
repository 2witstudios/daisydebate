import { z } from 'zod';
import {
  crossExModeSchema,
  interruptionModeSchema,
  MAX_PRE_ROUND_PREP_MS,
} from './format';
import { formatResolutionDrawSchema } from './resolution-draw';

/**
 * "Available and declined" has exactly one spelling per level (ADR 0058):
 * a `null` capability in the definition means forbidden, so the config has
 * nothing to spell; `{ enabled: false }` here means the capability exists
 * and this room declined it. `forbidden ≠ available-but-disabled`.
 */
const declinedSchema = z.strictObject({ enabled: z.literal(false) });

const preRoundPrepSchema = z.discriminatedUnion('enabled', [
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

/**
 * The values a format sanctions within its definition: timing,
 * cross-examination, interruptions, yielding and prep. A Room embeds them
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
  crossExamination: z.strictObject({ crossExMode: crossExModeSchema }),
  /** Null only when the format forbids interruptions; otherwise an explicit legal choice. */
  interruptions: z
    .strictObject({
      mode: interruptionModeSchema,
      minRemainingMs: z.int().min(0),
    })
    .nullable(),
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
