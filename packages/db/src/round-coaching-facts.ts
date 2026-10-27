import { createAppError } from '@daisy/errors';
import {
  ballotFeedbackSchema,
  debateSides,
  type DebateSide,
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
  ai_ballots: z.array(
    z.object({ submitted: z.boolean(), sides: z.array(z.string()) }),
  ),
  pass: z
    .object({
      status: z.enum(['leased', 'succeeded', 'failed']),
      attempts: z.number().int().positive(),
      leaseExpiresAt: instant.nullable(),
      feedback: ballotFeedbackSchema.nullable(),
    })
    .nullable(),
});

/**
 * Plain facts the coaching decision is made from (ADR 0071). The decision,
 * its window and its budget belong to the coaching feature, not here.
 */
export type RoundCoachingFacts = {
  readonly status: string;
  readonly completedAt: string | null;
  /** Whether the Round froze a transcript, and how many lines it has. */
  readonly frozen: boolean;
  readonly lines: number;
  /** Each AI judge ballot: whether it is submitted, and the sides it coached. */
  readonly aiBallots: readonly {
    readonly submitted: boolean;
    readonly sides: readonly DebateSide[];
  }[];
  /** The coaching pass's row, once any attempt was claimed. */
  readonly pass: {
    readonly status: 'leased' | 'succeeded' | 'failed';
    readonly attempts: number;
    readonly leaseExpiresAt: string | null;
    readonly feedback: Readonly<Partial<Record<DebateSide, string>>> | null;
  } | null;
};

export async function readRoundCoachingFacts(
  reader: Reader,
  roundId: string,
): Promise<RoundCoachingFacts> {
  const [row] = (await reader.execute(sql`select r.status, r.completed_at,
    exists (select 1 from round_transcript_freezes z where z.round_id = r.id) as frozen,
    (select count(*) from utterances u where u.round_id = r.id) as lines,
    coalesce((select json_agg(json_build_object(
        'submitted', b.status = 'submitted',
        'sides', (select coalesce(json_agg(k), '[]'::json)
          from jsonb_object_keys(coalesce(b.feedback, '{}'::jsonb)) k)))
      from ballots b
      join round_participants p on p.id = b.judge_participant_id
      join actors a on a.id = p.actor_id
      where b.round_id = r.id and a.kind = 'bot'), '[]'::json) as ai_ballots,
    (select json_build_object('status', f.status, 'attempts', f.attempts,
        'leaseExpiresAt', f.lease_expires_at, 'feedback', f.feedback)
      from round_feedback f where f.round_id = r.id) as pass
    from rounds r where r.id = ${roundId}`)) as unknown as unknown[];
  if (!row) throw createAppError('NOT_FOUND');
  const facts = factsSchema.parse(row);
  return {
    status: facts.status,
    completedAt: facts.completed_at,
    frozen: facts.frozen,
    lines: facts.lines,
    aiBallots: facts.ai_ballots.map((ballot) => ({
      submitted: ballot.submitted,
      sides: debateSides.filter((side) => ballot.sides.includes(side)),
    })),
    pass: facts.pass,
  };
}
