import { z } from 'zod';
import { ballotScoresSchema } from './ballot';
import { debateSideSchema, idSchema } from './primitives';

const spectatorStageSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('upcoming') }),
  /** Nothing public on the stage: prep, judging, or facts not yet released. */
  z.strictObject({ kind: z.literal('slate') }),
  z.strictObject({
    kind: z.literal('floor'),
    segment: z.enum(['speech', 'cross_ex']),
    label: z.string(),
    side: debateSideSchema,
    /** The clock as the released video shows it. */
    remainingMs: z.int().nonnegative(),
  }),
  z.strictObject({ kind: z.literal('ended') }),
]);

/**
 * What an audience may know of a Round, and only once released (ADR 0099).
 * Judges are never named, and no side's feedback appears here: it stays
 * private to that side.
 */
export const spectatorTimelineSchema = z.strictObject({
  version: z.literal(1),
  roundId: idSchema,
  mode: z.enum(['ranked', 'casual']),
  hasBroadcast: z.boolean(),
  resolution: z.string().nullable(),
  seats: z.array(
    z.strictObject({
      side: debateSideSchema,
      kind: z.enum(['human', 'bot']),
      label: z.string().nullable(),
    }),
  ),
  stage: spectatorStageSchema,
  result: z
    .strictObject({
      /** Null is a tie or an ending with no winner, never a draw. */
      winner: debateSideSchema.nullable(),
      ballots: z.array(
        z.strictObject({
          winner: debateSideSchema,
          scores: ballotScoresSchema,
          reason: z.string(),
        }),
      ),
      ratings: z.array(
        z.strictObject({
          side: debateSideSchema,
          before: z.int(),
          after: z.int(),
        }),
      ),
    })
    .nullable(),
  /** Ranked only (DEC-301): a non-ranked Round has none. */
  captions: z.array(
    z.strictObject({
      id: idSchema,
      side: debateSideSchema,
      text: z.string(),
    }),
  ),
  releasedThrough: z.iso.datetime().nullable(),
});
export type SpectatorTimeline = z.infer<typeof spectatorTimelineSchema>;
