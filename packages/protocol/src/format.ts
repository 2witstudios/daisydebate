import { z } from 'zod';
import { seatRefSchema, sideKeySchema, sideSchema } from './seats';
import { MAX_FORMAT_SEATS, sideKeysOf } from './format-seating';
import { validateSeating } from './format-seating-refusals';
import {
  drawSources,
  MAX_DRAW_SIZE,
  MAX_STRIKE_WINDOW_MS,
  MIN_DRAW_SIZE,
  MIN_STRIKE_WINDOW_MS,
} from './resolution-draw';

/** The longest prep before a round: two hours, so its end is always a real date. */
export const MAX_PRE_ROUND_PREP_MS = 7_200_000;

/**
 * The most segments a format or its resolved rules admit (DEC-131): real
 * formats use 6-12, and a finite bound keeps every Room and Round body
 * provably small, as MAX_FORMAT_SEATS does for seats.
 */
export const MAX_FORMAT_SEGMENTS = 64;

/** A permitted set drawn from a vocabulary: non-empty, no repeats, so never longer than it. */
const optionSet = <T extends z.ZodType>(option: T, vocabulary: number) =>
  z
    .array(option)
    .min(1)
    .max(vocabulary)
    .refine((values) => new Set(values).size === values.length, {
      message: 'Options must not repeat',
    });
/**
 * Who sits in a format (TAB-6.2): each declared side's seats, the unsided
 * speakers, the judges and at most one moderator. A format is sided or
 * unsided, never both, which the definition and rules refine.
 */
export const formatSeatsSchema = z
  .strictObject({
    sides: z.record(sideKeySchema, z.int().min(1).max(MAX_FORMAT_SEATS)),
    speakers: z.int().min(0).max(MAX_FORMAT_SEATS),
    judges: z.int().min(0).max(MAX_FORMAT_SEATS),
    moderators: z.union([z.literal(0), z.literal(1)]),
  })
  .superRefine((seats, ctx) => {
    const sided = Object.values(seats.sides).reduce((sum, n) => sum + n, 0);
    if (
      sided + seats.speakers + seats.judges + seats.moderators >
      MAX_FORMAT_SEATS
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Total seats exceed the format resource budget',
      });
  });

/**
 * The segment types a format's grammar is built from. Prep is deliberately
 * absent: neither kind of prep is a competitive interval with a transcript,
 * so it is policy in the rules, never a segment (ADR 0058). A speech has one
 * speaker; cross-examination and an open floor have several (TAB-6.2).
 */
export const segmentTypes = ['speech', 'cross_ex', 'open'] as const;
const segmentTypeSchema = z.enum(segmentTypes);
export type SegmentType = (typeof segmentTypes)[number];

/**
 * Who may hold the floor in a segment (TAB-6.2): one seat, several, or every
 * seat but a judge's. `lead` is the seat the segment is scheduled to (the
 * asker in cross-examination): prep and the clock read it.
 */
export const speakRightsSchema = z.discriminatedUnion('rights', [
  z.strictObject({ rights: z.literal('one'), seat: seatRefSchema }),
  z.strictObject({
    rights: z.literal('several'),
    seats: z.array(seatRefSchema).min(2).max(MAX_FORMAT_SEATS),
    lead: seatRefSchema.nullable(),
  }),
  z.strictObject({ rights: z.literal('all'), lead: seatRefSchema.nullable() }),
]);

/**
 * What a Round decides (TAB-6.2): a winning side, a ranking of the sides or
 * of the speakers, or nothing at all.
 */
const formatOutcomeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('winner') }),
  z.strictObject({
    kind: z.literal('ranking'),
    of: z.enum(['sides', 'speakers']),
  }),
  z.strictObject({ kind: z.literal('none') }),
]);
export type FormatOutcome = z.infer<typeof formatOutcomeSchema>;

/** A format's sides: none (unsided), or two to four with unique keys. */
const formatSidesSchema = z.array(sideSchema).max(4);

/**
 * What another debater may do during a speech (ADR 0096). Cross-examination
 * never has interruptions: both sides speak for all of it.
 */
const interruptionModes = ['disabled', 'enabled', 'open'] as const;
export const interruptionModeSchema = z.enum(interruptionModes);

/**
 * The frozen interruption policy. Forbidden has one spelling, whether the
 * format forbids interruptions or the settings declined them, and only an
 * enabled policy has a protected end.
 */
export const interruptionRuleSchema = z.discriminatedUnion('allowed', [
  z.strictObject({ allowed: z.literal('disabled') }),
  z.strictObject({ allowed: z.literal('open') }),
  z.strictObject({
    allowed: z.literal('enabled'),
    minRemainingMs: z.int().min(0),
  }),
]);

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
  /** Who may hold the floor, and the seat the segment is scheduled to. */
  speak: speakRightsSchema,
};

const segmentSchema = z.strictObject({
  ...segmentIdentity,
  /** The format's own timing: the default a room may override per segment. */
  defaultDurationMs: z.int().positive(),
});

/**
 * What a format permits, version 2 (ADR 0058, TAB-6.2): its sides, seats and
 * outcome kind, the grammar and default
 * schedule, plus nullable capabilities. `null` means the format forbids a
 * capability outright, so a room has nothing to configure — forbidden is
 * never spelled `enabled: false` here. Interaction capabilities are
 * permitted sets: the definition answers "which configurations may a room
 * choose?", never "what did this room choose?".
 */
const formatDefinitionShape = z.strictObject({
  version: z.literal(2),
  sides: formatSidesSchema,
  seats: formatSeatsSchema,
  outcome: formatOutcomeSchema,
  segments: z.array(segmentSchema).min(1).max(MAX_FORMAT_SEGMENTS),
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
        spendableBefore: optionSet(segmentTypeSchema, segmentTypes.length),
        /** Segment key the budget dies at; null = the whole round. */
        expiresAtSegment: z.string().trim().min(1).max(8).nullable(),
      })
      .nullable(),
    /** Room-only: the pre-round product flow, executed before any Round. */
    preRoundPrep: z.strictObject({ durationMs: boundSchema }).nullable(),
    /** Room-only: the pre-round resolution draw and strike (FMT-7). */
    resolutionDraw: z
      .strictObject({
        drawSize: boundSchema,
        strikeWindowMs: boundSchema,
        firstStrikers: optionSet(sideKeySchema, 2),
        sources: optionSet(z.enum(drawSources), drawSources.length),
      })
      .nullable(),
    interaction: z.strictObject({
      interruptions: z
        .strictObject({
          modes: optionSet(interruptionModeSchema, interruptionModes.length),
          minRemainingMs: boundSchema,
        })
        .nullable(),
      yield: z
        .strictObject({
          /** e.g. [true] = must yield; [true, false] = the room may choose. */
          enabledChoices: optionSet(z.boolean(), 2),
          returnsTimeChoices: optionSet(z.boolean(), 2),
        })
        .nullable(),
    }),
  }),
});

/** In-round prep is a side's, and the resolution strike is a pair's. */
function validateSideCapabilities(
  definition: z.infer<typeof formatDefinitionShape>,
  ctx: z.RefinementCtx,
) {
  const keys = sideKeysOf(definition);
  const { inRoundPrep, resolutionDraw } = definition.configurable;
  if (inRoundPrep && keys.length === 0)
    ctx.addIssue({
      code: 'custom',
      message: 'In-round prep is spent by a side',
      path: ['configurable', 'inRoundPrep'],
    });
  if (!resolutionDraw) return;
  if (keys.length !== 2)
    ctx.addIssue({
      code: 'custom',
      message: 'The resolution strike needs exactly two sides',
      path: ['configurable', 'resolutionDraw'],
    });
  for (const [index, striker] of resolutionDraw.firstStrikers.entries())
    if (!keys.includes(striker))
      ctx.addIssue({
        code: 'custom',
        message: 'A first striker is a declared side',
        path: ['configurable', 'resolutionDraw', 'firstStrikers', index],
      });
}

/** Room-only bounds every due instant depends on: draw size, strike window, prep. */
function validateRoomOnlyBounds(
  definition: z.infer<typeof formatDefinitionShape>,
  ctx: z.RefinementCtx,
) {
  const { resolutionDraw: draw, preRoundPrep } = definition.configurable;
  const outside = (
    bound: { readonly min: number; readonly max: number },
    min: number,
    max: number,
  ) => bound.min < min || bound.max > max;
  for (const [field, bound, min, max, message] of [
    [
      'drawSize',
      draw?.drawSize,
      MIN_DRAW_SIZE,
      MAX_DRAW_SIZE,
      'A draw holds 2 to 20 resolutions',
    ],
    [
      'strikeWindowMs',
      draw?.strikeWindowMs,
      MIN_STRIKE_WINDOW_MS,
      MAX_STRIKE_WINDOW_MS,
      'A strike window is ten seconds to ten minutes',
    ],
  ] as const)
    if (bound && outside(bound, min, max))
      ctx.addIssue({
        code: 'custom',
        message,
        path: ['configurable', 'resolutionDraw', field],
      });
  if (preRoundPrep && preRoundPrep.durationMs.max > MAX_PRE_ROUND_PREP_MS)
    ctx.addIssue({
      code: 'custom',
      message: 'Prep before the round is at most two hours',
      path: ['configurable', 'preRoundPrep', 'durationMs'],
    });
}

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
    validateSeating(definition, ctx);
    validateSideCapabilities(definition, ctx);
    validateSegmentReferences(definition, ctx);
    validateRoomOnlyBounds(definition, ctx);
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
 * The executable ruleset, version 3 (ADR 0058, TAB-6.2): fully resolved, immutable on
 * `rounds.rules_snapshot`, the only rules shape the engine ever reads. No field
 * originates in the compiler — every value traces to the definition or the
 * config. Carries in-round prep (nullable), never pre-round prep.
 */
export const roundRulesSchema = z
  .strictObject({
    version: z.literal(3),
    sides: formatSidesSchema,
    seats: formatSeatsSchema,
    outcome: formatOutcomeSchema,
    segments: z.array(rulesSegmentSchema).min(1).max(MAX_FORMAT_SEGMENTS),
    inRoundPrep: z
      .strictObject({
        budgetMsPerSide: z.int().min(0),
        spendableBefore: optionSet(segmentTypeSchema, segmentTypes.length),
        expiresAtSegment: z.string().trim().min(1).max(8).nullable(),
      })
      .nullable(),
    countdownMs: z.int().min(0),
    interaction: z.strictObject({
      /** The speaker voluntarily ends their own control. */
      yield: z
        .strictObject({ allowed: z.boolean(), returnsTime: z.boolean() })
        .nullable(),
      /** Another participant takes the floor during active control. */
      interruptions: interruptionRuleSchema,
    }),
  })
  .superRefine((rules, ctx) => {
    validateSeating(rules, ctx);
    if (rules.inRoundPrep && rules.sides.length === 0)
      ctx.addIssue({
        code: 'custom',
        message: 'In-round prep is spent by a side',
        path: ['inRoundPrep'],
      });
  });
export type RoundRules = z.infer<typeof roundRulesSchema>;
