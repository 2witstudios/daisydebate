import { z } from 'zod';
import { debateSides, idSchema, type DebateSide } from './primitives';

/** Internal facts from the locked Round; never a public command body. */
export type RoundUnjudgedCompletion = {
  readonly competitionType: 'casual' | 'practice' | 'ranked';
  readonly now: string;
  /** The Round's stored ballots and the deadline persisted at its freeze (DEC-201, DEC-207). */
  readonly ballots: readonly {
    readonly judgeParticipantId: string;
    readonly winner: DebateSide;
    readonly status: 'submitted' | 'voided';
  }[];
  readonly ballotDeadlineAt: string | null;
};

/**
 * One durable finalization command; replay keeps its original result. A
 * zero-judge Round is `unjudged`. Past the ballot deadline (DEC-201) the
 * judges in `noRuling` gave no ruling: with no ballot at all the judges did
 * not rule and there is no outcome; otherwise the submitted ballots decide.
 */
export const roundUnjudgedReceiptSchema = z.strictObject({
  version: z.literal(1),
  commandId: idSchema,
  roundId: idSchema,
  freezeRevision: z.int().positive(),
  resultingVersion: z.int().positive(),
  status: z.literal('completed'),
  ruling: z.enum(['unjudged', 'judges-did-not-rule', 'partial']),
  outcome: z.enum([...debateSides, 'draw']).nullable(),
  noRuling: z.array(idSchema).readonly(),
  replayed: z.boolean(),
});
export type RoundUnjudgedReceipt = z.infer<typeof roundUnjudgedReceiptSchema>;
