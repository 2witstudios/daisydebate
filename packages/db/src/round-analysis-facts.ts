import { createAppError } from '@daisy/errors';
import { analysisWorkSchema, type AnalysisWork } from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { z } from 'zod';
const instant = z
  .union([z.date(), z.string()])
  .transform((value) => new Date(value).toISOString());
const factsSchema = z.object({
  status: z.string(),
  completed_at: instant.nullable(),
  frozen: z.boolean(),
  lines: z.coerce.number().int().nonnegative(),
  analysis: analysisWorkSchema.nullable(),
});
/** Frozen evidence availability and the seat's one requested/terminal identity; never ballots. */
export type RoundAnalysisFacts = {
  readonly status: string;
  readonly completedAt: string | null;
  readonly frozen: boolean;
  readonly lines: number;
  readonly analysis: AnalysisWork | null;
};
export async function readRoundAnalysisFacts(
  reader: Pick<BunSQLDatabase, 'execute'>,
  seat: { readonly roundId: string; readonly roundParticipantId: string },
): Promise<RoundAnalysisFacts> {
  const [row] = await reader.execute(sql`select r.status,r.completed_at,
    exists(select 1 from round_transcript_freezes z where z.round_id=r.id and (a.freeze_revision is null or a.freeze_revision=z.revision)) as frozen,
    (select count(*) from utterances u where u.round_id=r.id) as lines,a.work as analysis
    from rounds r left join round_analyses a on a.round_id=r.id and a.round_participant_id=${seat.roundParticipantId}
    where r.id=${seat.roundId}`);
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
