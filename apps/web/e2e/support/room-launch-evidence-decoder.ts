import { z } from 'zod';
import { idSchema, roomConfigSchema, roundRulesSchema } from '@daisy/protocol';
const count = z.int().nonnegative();
const evidence = z.strictObject({
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  counts: z.strictObject({
    users: count,
    actors: count,
    rooms: count,
    rounds: count,
    seats: count,
    roundSeats: count,
    commands: count,
    outbox: count,
  }),
  frozen: z.array(
    z.strictObject({
      status: z.literal('scheduled'),
      topic: z.string().min(1),
      config: roomConfigSchema,
      rules: roundRulesSchema,
      cast: z.array(idSchema),
      startedAt: z.null(),
    }),
  ),
  launchDoorbells: count,
});
/** Exact local portable boundary; malformed worker output never becomes evidence. */
export function decodeLaunchEvidence(stdout: string) {
  try {
    return evidence.parse(JSON.parse(stdout));
  } catch {
    throw new Error('Invalid Launch evidence payload');
  }
}
