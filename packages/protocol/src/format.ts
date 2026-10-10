import { z } from 'zod';
import { debateRoleSchema, debateSideSchema } from './primitives';

/** Provisional resource budget: bounds expanded seat records and per-seat command work,
 * independent of any league roster policy. Judges consume the same budget. */
export const MAX_FORMAT_SEATS = 256;
export const formatSeatsSchema = z
  .record(debateRoleSchema, z.int().min(0).max(MAX_FORMAT_SEATS))
  .superRefine((seats, ctx) => {
    if (seats.affirmative + seats.negative + seats.judge > MAX_FORMAT_SEATS)
      ctx.addIssue({
        code: 'custom',
        message: 'Total seats exceed the format resource budget',
      });
    for (const side of ['affirmative', 'negative'] as const)
      if (seats[side] === 0)
        ctx.addIssue({
          code: 'custom',
          message: 'Both debate sides require seats',
          path: [side],
        });
  });

/** Speech and cross-ex both give the declared side a legal speaking floor. */
function validateSpeakingOpportunities(
  schedule: {
    seats: z.infer<typeof formatSeatsSchema>;
    segments: Array<{ side: 'affirmative' | 'negative'; slot: number }>;
  },
  ctx: z.RefinementCtx,
) {
  for (const [index, segment] of schedule.segments.entries())
    if (segment.slot >= schedule.seats[segment.side])
      ctx.addIssue({
        code: 'custom',
        message: 'Segment requires a declared speaker seat',
        path: ['segments', index, 'slot'],
      });
  for (const side of ['affirmative', 'negative'] as const)
    if (
      !schedule.segments.some(
        (segment) =>
          segment.side === side && segment.slot < schedule.seats[side],
      )
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Both debate sides require a legal speaking opportunity',
        path: ['segments'],
      });
}

/**
 * The segment types a format's grammar is built from. Prep is deliberately
 * absent: neither kind of prep is a competitive interval with a transcript,
 * so it is policy in the rules, never a segment (ADR 0058).
 */
export const segmentTypes = ['speech', 'cross_ex'] as const;
const segmentTypeSchema = z.enum(segmentTypes);
export type SegmentType = (typeof segmentTypes)[number];

/** How a cross-examination segment's floor may move. */
const crossExModes = ['ordered', 'free'] as const;
export const crossExModeSchema = z.enum(crossExModes);

/**
 * Whether another participant may take the floor mid-segment, and where.
 * A three-state policy, not a boolean: "interruptions on" and "interruptions
 * during cross-examination only" are different debates (ADR 0058).
 */
const interruptionModes = ['disabled', 'cross_ex_only', 'enabled'] as const;
export const interruptionModeSchema = z.enum(interruptionModes);

/** An inclusive millisecond range a room's chosen value must land inside. */
const boundSchema = z
  .strictObject({
    min: z.int().min(0),
    max: z.int().min(0),
  })
  .refine((bound) => bound.min <= bound.max, 'Minimum must not exceed maximum');

/** The segment identity both the definition's grammar and the resolved rules carry. */
const segmentIdentity = {
  /** The stable short name: AC, CX, NC, 1AR, NR, 2AR. */
  key: z.string().trim().min(1).max(8),
  /** The displayed name: 'Affirmative constructive'. */
  label: z.string().trim().min(1).max(80),
  type: segmentTypeSchema,
  /** The speaking side; for cross-examination, the asking side. */
  side: debateSideSchema,
  slot: z.int().min(0),
};

const segmentSchema = z.strictObject({
  ...segmentIdentity,
  /** The format's own timing: the default a room may override per segment. */
  defaultDurationMs: z.int().positive(),
});

/**
 * What a format permits, version 1 (ADR 0058): the grammar and default
 * schedule, plus nullable capabilities. `null` means the format forbids a
 * capability outright, so a room has nothing to configure — forbidden is
 * never spelled `enabled: false` here. Interaction capabilities are
 * permitted sets: the definition answers "which configurations may a room
 * choose?", never "what did this room choose?".
 */
const formatDefinitionShape = z.strictObject({
  version: z.literal(1),
  /** Exhaustive over the role vocabulary: every role declares its seats. */
  seats: formatSeatsSchema,
  segments: z.array(segmentSchema).min(1),
  configurable: z.strictObject({
    timing: z.strictObject({
      /** Per-segment bounds; keys must correspond exactly to segments. */
      segmentDurationMs: z.record(z.string(), boundSchema),
      countdownMs: boundSchema,
    }),
    /** PrepBounds | null — when prep may be spent is structure, not choice. */
    inRoundPrep: z
      .strictObject({
        budgetMsPerSide: boundSchema,
        spendableBefore: z.array(segmentTypeSchema).min(1),
        /** Segment key the budget dies at; null = the whole round. */
        expiresAtSegment: z.string().trim().min(1).max(8).nullable(),
      })
      .nullable(),
    /** Room-only: the pre-round product flow, executed before any Round. */
    preRoundPrep: z.strictObject({ durationMs: boundSchema }).nullable(),
    interaction: z.strictObject({
      crossExModes: z.array(crossExModeSchema).min(1),
      interruptions: z
        .strictObject({
          modes: z.array(interruptionModeSchema).min(1),
          minRemainingMs: boundSchema,
        })
        .nullable(),
      yield: z
        .strictObject({
          /** e.g. [true] = must yield; [true, false] = the room may choose. */
          enabledChoices: z.array(z.boolean()).min(1),
          returnsTimeChoices: z.array(z.boolean()).min(1),
        })
        .nullable(),
    }),
  }),
});

function validateSegmentReferences(
  definition: z.infer<typeof formatDefinitionShape>,
  ctx: z.RefinementCtx,
) {
  const keys = definition.segments.map((segment) => segment.key);
  for (const [index, segment] of definition.segments.entries()) {
    const bounds =
      definition.configurable.timing.segmentDurationMs[segment.key];
    if (
      bounds &&
      (segment.defaultDurationMs < bounds.min ||
        segment.defaultDurationMs > bounds.max)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Default duration must be within segment bounds',
        path: ['segments', index, 'defaultDurationMs'],
      });
  }
  const expiresAt = definition.configurable.inRoundPrep?.expiresAtSegment;
  if (expiresAt && !keys.includes(expiresAt))
    ctx.addIssue({
      code: 'custom',
      message: 'Prep expiry requires a declared segment',
      path: ['configurable', 'inRoundPrep', 'expiresAtSegment'],
    });
}

export const formatDefinitionSchema = formatDefinitionShape.superRefine(
  (definition, ctx) => {
    const keys = definition.segments.map((segment) => segment.key);
    if (new Set(keys).size !== keys.length)
      ctx.addIssue({
        code: 'custom',
        message: 'Segment keys must be unique',
        path: ['segments'],
      });
    validateSpeakingOpportunities(definition, ctx);
    validateSegmentReferences(definition, ctx);
    const timingKeys = Object.keys(
      definition.configurable.timing.segmentDurationMs,
    );
    if (
      timingKeys.length !== keys.length ||
      !keys.every((key) => timingKeys.includes(key))
    )
      ctx.addIssue({
        code: 'custom',
        message:
          'segmentDurationMs bounds must correspond exactly to the segments',
        path: ['configurable', 'timing', 'segmentDurationMs'],
      });
  },
);
export type FormatDefinition = z.infer<typeof formatDefinitionSchema>;

/** One resolved segment: the definition's identity, the room's duration. */
const rulesSegmentSchema = z.strictObject({
  ...segmentIdentity,
  /** Resolved, not a range: override within bounds, else the default. */
  durationMs: z.int().positive(),
});

/**
 * The executable ruleset, version 2 (ADR 0058): fully resolved, immutable on
 * `rounds.rules_snapshot`, the only rules shape ECS ever reads. No field
 * originates in the compiler — every value traces to the definition or the
 * config. Carries in-round prep (nullable), never pre-round prep.
 */
export const roundRulesSchema = z
  .strictObject({
    version: z.literal(2),
    seats: formatSeatsSchema,
    segments: z.array(rulesSegmentSchema).min(1),
    inRoundPrep: z
      .strictObject({
        budgetMsPerSide: z.int().min(0),
        spendableBefore: z.array(segmentTypeSchema).min(1),
        expiresAtSegment: z.string().trim().min(1).max(8).nullable(),
      })
      .nullable(),
    countdownMs: z.int().min(0),
    interaction: z.strictObject({
      crossExMode: crossExModeSchema,
      /** The speaker voluntarily ends their own control. */
      yield: z
        .strictObject({ allowed: z.boolean(), returnsTime: z.boolean() })
        .nullable(),
      /** Another participant takes the floor during active control. */
      interruptions: z
        .strictObject({
          allowed: interruptionModeSchema,
          minRemainingMs: z.int().min(0),
        })
        .nullable(),
    }),
  })
  .superRefine(validateSpeakingOpportunities);
export type RoundRules = z.infer<typeof roundRulesSchema>;
