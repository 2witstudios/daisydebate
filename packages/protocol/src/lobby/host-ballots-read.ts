import { z } from 'zod';
import { idSchema } from '../primitives';

/** Ballots-area addressing only. Each Round owns the separate private ballot read. */
export const hostBallotsViewSchema = z.strictObject({
  lobbyId: idSchema,
  eventId: idSchema,
  canResolve: z.boolean(),
  rounds: z.array(
    z.strictObject({
      roundId: idSchema,
      fixtureId: idSchema,
      tabRoundName: z.string().nullable(),
      roomTitle: z.string(),
    }),
  ),
});
export type HostBallotsView = z.infer<typeof hostBallotsViewSchema>;
