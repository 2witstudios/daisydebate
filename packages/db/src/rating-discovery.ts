import { createAppError } from '@daisy/errors';
import {
  idSchema,
  isRoundEndState,
  type AttendanceLedgerFacts,
  type EndingRatingFacts,
  type RatingEligibilityFacts,
  type RecordedEnding,
  type RoundOutcome,
  type RoundStatus,
} from '@daisy/protocol';
import { roundOutcomeSql } from './round-outcome-sql';
import { sql, type SQL } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import {
  attendanceLedgerColumns,
  attendanceLedgerFacts,
} from './attendance-settlement';
import { recordedEnding, recordedEndingJoins } from './recorded-ending';

/**
 * Loads the facts the engine decides a rating from. This file selects and
 * reads; `ratingEligibility` says who is rated (ADR 0055, ADR 0058).
 */

type Execute = Pick<BunSQLDatabase, 'execute'>;

/** A Round to rate, or one whose ledger row is corrupt: it fails alone, and the page moves on. */
export type RatingCandidate =
  | { readonly roundId: string; readonly facts: RatingEligibilityFacts }
  | {
      readonly roundId: string;
      readonly facts: null;
      readonly unreadable: unknown;
    };

type EndingRow = {
  readonly status: RoundStatus;
  readonly outcome: RoundOutcome | null;
  readonly completedAt: string | null;
  readonly ending: RecordedEnding;
} & Record<keyof AttendanceLedgerFacts, unknown> & { readonly roundId: string };

type FactsRow = EndingRow &
  Omit<RatingEligibilityFacts, keyof EndingRatingFacts>;

/** A Round's ending facts, or why its row is unreadable: it is never rated. */
type EndingRead<Facts> =
  | { readonly roundId: string; readonly facts: Facts }
  | {
      readonly roundId: string;
      readonly facts: null;
      readonly unreadable: unknown;
    };

/** The ending columns over the Round alias `r`, joined by `recordedEndingJoins`. */
const endingColumns = sql`r.id as "roundId", r.status, ${roundOutcomeSql('r')} as outcome,
      to_char(r.completed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "completedAt",
      ${recordedEnding} as ending,
      ${attendanceLedgerColumns}`;

const endingFacts = <Row extends EndingRow>({
  roundId,
  ruleSegments,
  speeches,
  adjudications,
  receipts,
  pendingWriter,
  ...facts
}: Row): EndingRead<
  Omit<Row, 'roundId' | keyof AttendanceLedgerFacts> & EndingRatingFacts
> => {
  try {
    // `rounds_lifecycle_check` holds this; a row that breaks it is unreadable, never rated.
    if (!isRoundEndState(facts))
      throw createAppError(
        'INVARIANT',
        'Round ending is not one its status holds',
      );
    return {
      roundId,
      facts: {
        ...facts,
        attendance: attendanceLedgerFacts({
          ruleSegments,
          speeches,
          adjudications,
          receipts,
          pendingWriter,
        }),
      },
    };
  } catch (unreadable) {
    return { roundId, facts: null, unreadable };
  }
};

const readCandidates = async (
  db: Execute,
  selection: SQL,
): Promise<readonly RatingCandidate[]> => {
  const rows = (await db.execute(sql`select ${endingColumns},
      r.competition_type as "competitionType",
      case when r.ladder_id is null or jsonb_array_length(r.rules_snapshot->'sides') <> 2 then null else jsonb_build_object('lobbyId', r.rating_lobby_id, 'ladderId', r.ladder_id, 'seasonId', r.season_id) end as scope,
      daisy_round_rating_posted(r.id) as "alreadyRated"
    from rounds r ${recordedEndingJoins}
    where ${selection}`)) as unknown as FactsRow[];
  return rows.map(endingFacts);
};

/**
 * The ending facts of these Rounds, the same Daisy's ratings read, for a
 * ladder outside Daisy's own (a league's) to ask `endingRating` of.
 */
const endingReadBatch = 10_000;

export async function readEndingRatingFacts(
  db: Execute,
  roundIds: readonly string[],
): Promise<readonly EndingRead<EndingRatingFacts>[]> {
  if (!roundIds.every((id) => idSchema.safeParse(id).success))
    throw createAppError('VALIDATION');
  // Bound each query well below PostgreSQL's 65,535 bind parameters.
  const rows: EndingRow[] = [];
  for (let at = 0; at < roundIds.length; at += endingReadBatch)
    rows.push(
      ...((await db.execute(sql`select ${endingColumns}
    from rounds r ${recordedEndingJoins}
    where r.id = any(array[${sql.join(
      roundIds.slice(at, at + endingReadBatch).map((id) => sql`${id}`),
      sql`, `,
    )}]::text[])`)) as unknown as EndingRow[]),
    );
  return rows.map(endingFacts);
}

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
  // Pre-ledger league Rounds were replayed by play time. Process those pools
  // first in the same order, then use the regular stable Round ID cursor.
  const key = (alias: 'r' | 'witness') =>
    sql.raw(`(not ${alias}.legacy_league_rating,
    case when ${alias}.legacy_league_rating then ${alias}.completed_at else 'infinity'::timestamptz end,
    ${alias}.id)`);
  return readCandidates(
    db,
    sql`r.status='completed' and r.ladder_id is not null
      and jsonb_array_length(r.rules_snapshot->'sides')=2
      and (${input.afterId ?? null}::text is null or coalesce(
        ${key('r')} > (select ${key('witness')} from rounds witness where witness.id=${input.afterId ?? null}),
        r.id > ${input.afterId ?? null}))
      and not daisy_round_rating_posted(r.id)
    order by ${key('r')} limit ${input.limit}`,
  );
}

/** One Round's facts, or null when there is no such Round. */
export async function readRatingFacts(
  db: Execute,
  roundId: string,
): Promise<RatingEligibilityFacts | null> {
  if (!idSchema.safeParse(roundId).success) throw createAppError('VALIDATION');
  const [candidate] = await readCandidates(db, sql`r.id=${roundId}`);
  if (candidate?.facts === null) throw candidate.unreadable;
  return candidate?.facts ?? null;
}
