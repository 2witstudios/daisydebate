import { z } from 'zod';
import { idSchema } from './primitives';

/** Internal facts from the locked Round; never a public command body. */
export type RoundUnjudgedCompletion = {
  readonly competitionType: 'casual' | 'practice' | 'ranked';
  readonly now: string;
};

/** One durable finalization command; replay keeps its original result. */
export const roundUnjudgedReceiptSchema = z.strictObject({
  version: z.literal(1),
  commandId: idSchema,
  roundId: idSchema,
  freezeRevision: z.int().positive(),
  resultingVersion: z.int().positive(),
  status: z.literal('completed'),
  outcome: z.null(),
  replayed: z.boolean(),
});
export type RoundUnjudgedReceipt = z.infer<typeof roundUnjudgedReceiptSchema>;
