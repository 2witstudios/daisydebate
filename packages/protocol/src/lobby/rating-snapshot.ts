import { z } from 'zod';
import { idSchema } from '../primitives';

/** Frozen at the tournament's first accepted draw, shared by all its events. */
export const tournamentRatingSnapshotSchema = z.strictObject({
  takenAt: z.iso.datetime(),
  calculation: z.string().min(1),
  ladders: z.array(
    z.strictObject({
      ladderId: idSchema,
      actors: z.array(
        z.strictObject({
          actorId: idSchema,
          rating: z.number().finite().min(0).max(4000),
          deviation: z.number().finite().positive(),
        }),
      ),
    }),
  ),
  events: z.array(
    z.strictObject({ eventId: idSchema, ladderId: idSchema.nullable() }),
  ),
});
export type TournamentRatingSnapshot = z.infer<
  typeof tournamentRatingSnapshotSchema
>;
