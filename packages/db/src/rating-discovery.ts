import { createAppError } from '@daisy/errors';
import {
  idSchema,
  type AttendanceLedgerFacts,
  type RatingEligibilityFacts,
} from '@daisy/protocol';
import { sql, type SQL } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { attendanceLedgerColumns } from './attendance-settlement';
import { recordedEnding, recordedEndingJoins } from './recorded-ending';

/**
 * Loads the facts the engine decides a rating from. This file selects and
 * reads; `ratingEligibility` says who is rated (ADR 0055, ADR 0058).
 */

type Execute = Pick<BunSQLDatabase, 'execute'>;

export type RatingCandidate = {
  readonly roundId: string;
  readonly facts: RatingEligibilityFacts;
};

type FactsRow = Omit<RatingEligibilityFacts, 'attendance'> &
  AttendanceLedgerFacts & { readonly roundId: string };

const readCandidates = async (
  db: Execute,
  where: SQL,
): Promise<readonly RatingCandidate[]> => {
  const rows = (await db.execute(sql`select r.id as "roundId",
      r.competition_type as "competitionType", r.ladder_id as "ladderId",
      r.status, r.outcome,
      to_char(r.completed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "completedAt",
      exists(select 1 from rating_changes l where l.round_id=r.id) as "alreadyRated",
      ${recordedEnding} as ending,
      ${attendanceLedgerColumns}
    from rounds r ${recordedEndingJoins}
    where ${where}`)) as unknown as FactsRow[];
  return rows.map(
    ({
      roundId,
      ruleSegments,
      speeches,
      adjudications,
      receipts,
      pendingWriter,
      ...facts
    }) => ({
      roundId,
      facts: {
        ...facts,
        attendance: {
          ruleSegments,
          speeches,
          adjudications,
          receipts,
          pendingWriter,
        },
      },
    }),
  );
};

/**
 * One bounded page of completed Rounds on a ladder with no ledger rows, and
 * their facts. A page is over candidates, so a Round the engine leaves unrated
 * still advances the cursor.
 */
export async function readRatingCandidates(
  db: Execute,
  input: { readonly afterId?: string; readonly limit: number },
): Promise<readonly RatingCandidate[]> {
  if (
    (input.afterId !== undefined &&
      !idSchema.safeParse(input.afterId).success) ||
    !Number.isSafeInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > 1000
  )
    throw createAppError('VALIDATION');
  return readCandidates(
    db,
    sql`r.status='completed' and r.ladder_id is not null
      and (${input.afterId ?? null}::text is null or r.id > ${input.afterId ?? null})
      and not exists(select 1 from rating_changes l where l.round_id=r.id)
    order by r.id limit ${input.limit}`,
  );
}

/** One Round's facts, or null when there is no such Round. */
export async function readRatingFacts(
  db: Execute,
  roundId: string,
): Promise<RatingEligibilityFacts | null> {
  if (!idSchema.safeParse(roundId).success) throw createAppError('VALIDATION');
  const [candidate] = await readCandidates(db, sql`r.id=${roundId}`);
  return candidate?.facts ?? null;
}
