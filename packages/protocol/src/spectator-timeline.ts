import { recordingPreparationSchema } from './recording-processing';
import { z } from 'zod';
import { ballotScoresRecordSchema } from './ballot-schema';
import { segmentTypes } from './format';
import { idSchema } from './primitives';
import { roundOutcomeSchema } from './round-outcome';
import { seatRefSchema, sideKeySchema } from './seats';

const spectatorStageSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('upcoming') }),
  /**
   * Nothing public on the stage. `moment` is where the released speeches have
   * reached, or `unreleased` before anything may be said, never the Round's live position, which the audience may not know yet.
   */
  z.strictObject({
    kind: z.literal('slate'),
    moment: z.enum([
      'unreleased',
      'before_first_speech',
      'between_speeches',
      'speeches_over',
    ]),
  }),
  z.strictObject({
    kind: z.literal('floor'),
    segment: z.enum(segmentTypes),
    label: z.string(),
    /** The seat the segment is scheduled to; null for an open floor. */
    lead: seatRefSchema.nullable(),
    /** The clock as the released video shows it. */
    remainingMs: z.int().nonnegative(),
  }),
  z.strictObject({ kind: z.literal('ended') }),
]);

/**
 * Where a player reads a Broadcast, by its recorded delivery path, so a faster
 * path adds a variant here and a source in the player and reshapes nothing else.
 */
const broadcastStreamSchema = z.discriminatedUnion('path', [
  z.strictObject({ path: z.literal('owned_hls'), manifestUrl: z.url() }),
]);
export type BroadcastStream = z.infer<typeof broadcastStreamSchema>;

/** The audience's stream as they can use it now; each state says only what is true of it. */
const broadcastStandingSchema = z.discriminatedUnion('state', [
  /** The Round has no Broadcast this audience can play. */
  z.strictObject({ state: z.literal('none') }),
  z.strictObject({ state: z.literal('starting') }),
  z.strictObject({ state: z.literal('on_air'), stream: broadcastStreamSchema }),
  /** Released media stopped arriving; null when none ever left to play. */
  z.strictObject({
    state: z.literal('interrupted'),
    stream: broadcastStreamSchema.nullable(),
  }),
  z.strictObject({ state: z.literal('stopped') }),
  z.strictObject({ state: z.literal('failed') }),
  z.strictObject({ state: z.literal('ended') }),
]);
export type BroadcastStanding = z.infer<typeof broadcastStandingSchema>;

/**
 * What an audience may know of a Round, and only once released (ADR 0099).
 * Judges are never named, and no side's feedback appears here: it stays
 * private to that side.
 */
export const spectatorTimelineSchema = z.strictObject({
  version: z.literal(1),
  roundId: idSchema,
  mode: z.enum(['ranked', 'casual']),
  broadcast: broadcastStandingSchema,
  /** The Round's Recording once its end is released; `none` until then. */
  recording: z.enum(['none', 'processing', 'ready', 'failed']),
  /** Present while `recording` is `processing`: what is happening to it now. */
  recordingPreparation: recordingPreparationSchema.optional(),
  resolution: z.string().nullable(),
  seats: z.array(
    z.strictObject({
      seat: seatRefSchema,
      kind: z.enum(['human', 'bot']),
      label: z.string().nullable(),
    }),
  ),
  stage: spectatorStageSchema,
  result: z
    .strictObject({
      /** Null is a tie or an ending with no result, never a draw. */
      outcome: roundOutcomeSchema.nullable(),
      ballots: z.array(
        z.strictObject({
          /** Null for a ballot that named no winning side. */
          winner: sideKeySchema.nullable(),
          scores: ballotScoresRecordSchema,
          reason: z.string(),
        }),
      ),
      ratings: z.array(
        z.strictObject({
          side: sideKeySchema,
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
      seat: seatRefSchema,
      text: z.string(),
    }),
  ),
  releasedThrough: z.iso.datetime().nullable(),
});
export type SpectatorTimeline = z.infer<typeof spectatorTimelineSchema>;
