import { z } from 'zod';
import { idSchema } from './primitives';

/** Durable ordinary receipt; it grants no current judging, reading or media authority. */
export const roundJudgeAssignmentReceiptSchema = z.strictObject({
  kind: z.literal('judge_assignment'),
  commandId: idSchema,
  roundId: idSchema,
  slot: z.int().nonnegative(),
  assignmentVersion: z.int().positive(),
  participantId: idSchema.nullable(),
  resultingVersion: z.int().positive(),
  replayed: z.boolean(),
});
export type RoundJudgeAssignmentReceipt = z.infer<
  typeof roundJudgeAssignmentReceiptSchema
>;
