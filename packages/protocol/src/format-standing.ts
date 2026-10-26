import { z } from 'zod';
import { crossExModeSchema, interruptionModeSchema } from './format';
import { debateRoleSchema } from './primitives';

const msSchema = z.int().min(0);
const keySchema = z.string().trim().min(1).max(8);
const interruptionsSchema = z
  .strictObject({ allowed: interruptionModeSchema, minRemainingMs: msSchema })
  .nullable();
const yieldSchema = z
  .strictObject({ allowed: z.boolean(), returnsTime: z.boolean() })
  .nullable();

/**
 * One rule a room changed from its basis. An allowlist: every variant is
 * strict and none can carry host-authored text or a config object, so the
 * list is safe to show any viewer of the room.
 */
const formatChangeSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('seats'),
    role: debateRoleSchema,
    from: z.int().min(0),
    to: z.int().min(0),
  }),
  z.strictObject({
    kind: z.literal('segments'),
    added: z.array(keySchema),
    removed: z.array(keySchema),
    /** Kept keys whose speaker, type, label or position moved. */
    changed: z.array(keySchema),
  }),
  z.strictObject({
    kind: z.literal('segment-duration'),
    key: keySchema,
    fromMs: msSchema,
    toMs: msSchema,
  }),
  z.strictObject({
    kind: z.literal('countdown'),
    fromMs: msSchema,
    toMs: msSchema,
  }),
  ...(['in-round-prep', 'pre-round-prep'] as const).map((kind) =>
    z.strictObject({
      kind: z.literal(kind),
      fromMs: msSchema.nullable(),
      toMs: msSchema.nullable(),
    }),
  ),
  z.strictObject({
    kind: z.literal('cross-ex-mode'),
    from: crossExModeSchema,
    to: crossExModeSchema,
  }),
  z.strictObject({
    kind: z.literal('interruptions'),
    from: interruptionsSchema,
    to: interruptionsSchema,
  }),
  z.strictObject({
    kind: z.literal('yield'),
    from: yieldSchema,
    to: yieldSchema,
  }),
]);
export type FormatChange = z.infer<typeof formatChangeSchema>;

/**
 * Whether a room still runs its standard format, derived and never stored
 * (FMT-1). Descriptive only: it never grants reading or joining a room.
 */
export const formatStandingSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('standard'), formatId: z.string().min(1) }),
  z.strictObject({
    kind: z.literal('custom'),
    basis: z
      .strictObject({
        formatId: z.string().min(1),
        role: z.enum(['standard', 'template']),
      })
      .nullable(),
    changes: z.array(formatChangeSchema),
  }),
]);
export type FormatStanding = z.infer<typeof formatStandingSchema>;
