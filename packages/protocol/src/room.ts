import { z } from 'zod';
import { crossExModeSchema, interruptionModeSchema } from './format';

/**
 * "Available and declined" has exactly one spelling per level (ADR 0058):
 * a `null` capability in the definition means forbidden, so the config has
 * nothing to spell; `{ enabled: false }` here means the capability exists
 * and this room declined it. `forbidden ≠ available-but-disabled`.
 */
const declinedSchema = z.strictObject({ enabled: z.literal(false) });

const preRoundPrepSchema = z.discriminatedUnion('enabled', [
  declinedSchema,
  z.strictObject({ enabled: z.literal(true), durationMs: z.int().positive() }),
]);

const inRoundPrepSchema = z.discriminatedUnion('enabled', [
  declinedSchema,
  z.strictObject({
    enabled: z.literal(true),
    budgetMsPerSide: z.int().min(0),
  }),
]);

/**
 * The Room's whole configuration surface (ADR 0058) — broader than what
 * becomes a round rule: `preRoundPrep` is Room-executed and never reaches
 * ECS. Casual and practice rooms are user-authored; a ranked room has no
 * free-form config at all, its every value coming from the sanctioned
 * preset, which stores exactly this shape.
 */
export const roomConfigSchema = z.strictObject({
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
});
export type RoomConfig = z.infer<typeof roomConfigSchema>;

/**
 * What the Room executes before competition (ADR 0058): pre-round prep
 * alone. Readiness flow and document access are real settings, but their
 * source fields are not declared yet, so they do not ride here — adding
 * them is a separate decision that adds their fields to the definition,
 * the config and this plan together.
 */
export const roomExecutionPlanSchema = z.strictObject({
  preRoundPrep: preRoundPrepSchema,
});
export type RoomExecutionPlan = z.infer<typeof roomExecutionPlanSchema>;
