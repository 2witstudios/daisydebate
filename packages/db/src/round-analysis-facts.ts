import { createAppError } from '@daisy/errors';
import {
  roundAnalysisReportSchema,
  type RoundAnalysisReport,
} from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { z } from 'zod';

type Reader = Pick<BunSQLDatabase, 'execute'>;

const instant = z
  .union([z.date(), z.string()])
  .transform((value) => new Date(value).toISOString());
const factsSchema = z.object({
  status: z.string(),
  completed_at: instant.nullable(),
  frozen: z.boolean(),
  lines: z.coerce.number().int().nonnegative(),
  analysis: z
    .object({
      status: z.enum(['leased', 'succeeded', 'failed']),
      attempts: z.number().int().positive(),
      leaseExpiresAt: instant.nullable(),
      report: roundAnalysisReportSchema.nullable(),
    })
    .nullable(),
});

/**
 * Plain facts a seat's round analysis is decided from. The decision, its
 * window and its budget belong to the round-analysis feature, not here. No
 * ballot is read.
 */
export type RoundAnalysisFacts = {
  readonly status: string;
  readonly completedAt: string | null;
  /** Whether the Round froze a transcript, and how many lines it has. */
  readonly frozen: boolean;
  readonly lines: number;
  /** The seat's analysis row, once any attempt was claimed. */
  readonly analysis: {
    readonly status: 'leased' | 'succeeded' | 'failed';
    readonly attempts: number;
    readonly leaseExpiresAt: string | null;
    readonly report: RoundAnalysisReport | null;
  } | null;
};

export async function readRoundAnalysisFacts(
  reader: Reader,
  seat: { readonly roundId: string; readonly roundParticipantId: string },
): Promise<RoundAnalysisFacts> {
  const [row] = (await reader.execute(sql`select r.status, r.completed_at,
    exists (select 1 from round_transcript_freezes z where z.round_id = r.id) as frozen,
    (select count(*) from utterances u where u.round_id = r.id) as lines,
    (select json_build_object('status', f.status, 'attempts', f.attempts,
        'leaseExpiresAt', f.lease_expires_at, 'report', f.report)
      from round_analyses f
      where f.round_id = r.id and f.round_participant_id = ${seat.roundParticipantId}) as analysis
    from rounds r where r.id = ${seat.roundId}`)) as unknown as unknown[];
  if (!row) throw createAppError('NOT_FOUND');
  const facts = factsSchema.parse(row);
  return {
    status: facts.status,
    completedAt: facts.completed_at,
    frozen: facts.frozen,
    lines: facts.lines,
    analysis: facts.analysis,
  };
}
