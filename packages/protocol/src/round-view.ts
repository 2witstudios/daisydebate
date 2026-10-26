import { z } from 'zod';
import { idSchema, debateRoleSchema } from './primitives';
import { roomConfigSchema } from './room';
import { roundRulesSchema, segmentTypes } from './format';
import {
  competitionTypes,
  roundStatusSchema,
  runtimeCheckpointSchema,
} from './round';
import { unjudgedRulingSchema } from './round-unjudged';

const instant = z.iso.datetime({ offset: true });

const seatSchema = z.strictObject({
  id: idSchema,
  actorId: idSchema,
  kind: z.enum(['human', 'bot']),
  label: z.string(),
  role: debateRoleSchema,
  slot: z.int().nonnegative(),
});

/**
 * A human judge's seat for a viewer who may not know who judges (DEC-98,
 * DEC-174): no name, actor or participant identity, only that it is filled.
 */
const anonymousJudgeSchema = z.strictObject({
  role: z.literal('judge'),
  kind: z.literal('human'),
  slot: z.int().nonnegative(),
  anonymous: z.literal(true),
});

/**
 * One viewer's Round: the durable Launch read grammar plus the runtime
 * snapshot (checkpoint and segment rows, in sequence order) a client derives
 * the live position from with the shared reader
 * (`@daisy/debate-engine/position`); no position is precomputed. It never
 * carries the host's actor, and a human judge's identity only for that
 * judge or the host.
 */
export const roundViewSchema = z.strictObject({
  id: idSchema,
  roomId: idSchema,
  version: z.int().positive(),
  status: roundStatusSchema,
  competitionType: z.enum(competitionTypes),
  topic: z.string().min(1),
  visibility: z.enum(['public', 'unlisted', 'private']),
  config: roomConfigSchema,
  rules: roundRulesSchema,
  participants: z.array(z.union([seatSchema, anonymousJudgeSchema])).readonly(),
  startedAt: instant.nullable(),
  completedAt: instant.nullable(),
  outcome: z.enum(['affirmative', 'negative', 'draw']).nullable(),
  /** The unjudged finalizer's ruling, from its durable receipt; null for any other completion. */
  unjudgedRuling: unjudgedRulingSchema.nullable(),
  /** Whether this viewer hosts the Round; never which actor does. */
  viewerIsHost: z.boolean(),
  /** Null when the stored checkpoint is unreadable: no live position, not an error. */
  checkpoint: runtimeCheckpointSchema.nullable(),
  segments: z
    .array(
      z.strictObject({
        id: idSchema,
        sequence: z.int().nonnegative(),
        type: z.enum(segmentTypes),
        rulesSegmentKey: z.string().min(1),
        startedAt: instant,
        endedAt: instant.nullable(),
        durationMs: z.int().positive(),
      }),
    )
    .refine(
      (rows) => rows.every((row, i) => row.sequence === i),
      'Segments are in sequence order from 0',
    )
    .readonly(),
});
export type RoundView = z.infer<typeof roundViewSchema>;
export type RoundSeat = z.infer<typeof seatSchema>;

/**
 * The Round as stored, before projection for a viewer: every seat named
 * and the host's actor. Authorization reads it; it never leaves the server.
 */
export type LaunchedRound = Omit<RoundView, 'participants' | 'viewerIsHost'> & {
  readonly hostActorId: string | null;
  readonly participants: readonly RoundSeat[];
};

/** A seat that names its occupant; an anonymous judge seat does not. */
export const isNamedSeat = <T extends object>(
  seat: T,
): seat is Exclude<T, { readonly anonymous: true }> => !('anonymous' in seat);
