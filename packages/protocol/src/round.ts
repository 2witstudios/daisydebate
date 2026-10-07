import { z } from 'zod';
import { debateSideSchema, idSchema } from './primitives';

/**
 * The one competition vocabulary (ADR 0058): ratedness comes from
 * `competition_type` alone. What was `quick` is a preset dimension, not a
 * competition type — `roundLengths` below.
 */
export const competitionTypes = ['ranked', 'casual', 'practice'] as const;
export const competitionTypeSchema = z.enum(competitionTypes);
export type CompetitionType = (typeof competitionTypes)[number];

/** The preset dimension (`format_presets.length`): full or quick. */
export const roundLengths = ['full', 'quick'] as const;
export const roundLengthSchema = z.enum(roundLengths);
export type RoundLength = (typeof roundLengths)[number];

/**
 * The round lifecycle. `scheduled` is a legitimate round status: rules are
 * frozen and the clock has not started (ADR 0058). `abandoned` keeps
 * `started_at` nullable — a round may be abandoned before starting.
 */
export const roundStatuses = [
  'scheduled',
  'active',
  'completed',
  'abandoned',
] as const;
export const roundStatusSchema = z.enum(roundStatuses);
export type RoundStatus = (typeof roundStatuses)[number];

/** Where a running round is: what the clock is doing right now. */
export const roundStages = ['countdown', 'prep', 'live'] as const;
export const roundStageSchema = z.enum(roundStages);
export type RoundStage = (typeof roundStages)[number];

/**
 * The runtime checkpoint (ADR 0058 §4), version 1 — only what has no
 * durable row. The open `round_segments` row is the live interval; the
 * checkpoint holds the three facts a restart could not otherwise
 * reconstruct. Keys are the stored jsonb shape, matching the column's
 * database default verbatim. The equivalence: `current_stage = 'prep'` iff
 * `active_prep` is not null; effective prep consumption while prep is live
 * is `prep_consumed_ms[side] + (now - active_prep.started_at)`.
 */
export const runtimeCheckpointSchema = z.strictObject({
  version: z.literal(1),
  prep_consumed_ms: z.strictObject({
    affirmative: z.int().min(0),
    negative: z.int().min(0),
  }),
  active_prep: z
    .strictObject({ side: debateSideSchema, started_at: z.iso.datetime() })
    .nullable(),
  /**
   * Who holds the floor. Null whenever the answer is derivable from the
   * open segment plus the rules — i.e. the segment's own scheduled side
   * holds it. Set only by an accepted interruption; deliberately not the
   * legal-next participant, which would duplicate the rules and go stale.
   */
  floor: z
    .strictObject({
      holder_participant_id: idSchema,
      granted_at: z.iso.datetime(),
    })
    .nullable(),
});
export type RuntimeCheckpoint = z.infer<typeof runtimeCheckpointSchema>;

/** The checkpoint a fresh round hydrates with, equal to the column default. */
export const emptyRuntimeCheckpoint: RuntimeCheckpoint = {
  version: 1,
  prep_consumed_ms: { affirmative: 0, negative: 0 },
  active_prep: null,
  floor: null,
};
