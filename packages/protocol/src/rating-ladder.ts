import { z } from 'zod';

/** The competitive pool frozen together at Round Start. */
export const roundRatingScopeSchema = z
  .strictObject({
    lobbyId: z.string().min(1),
    ladderId: z.string().min(1),
    seasonId: z.string().min(1),
  })
  .nullable();
export type RoundRatingScope = z.infer<typeof roundRatingScopeSchema>;
