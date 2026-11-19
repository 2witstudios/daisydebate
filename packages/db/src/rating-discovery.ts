import { daisyOrganizationId } from './daisy-reference';
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
import {
  attendanceLedgerColumns,
  attendanceLedgerFacts,
} from './attendance-settlement';
import { recordedEnding, recordedEndingJoins } from './recorded-ending';
import type { Tx } from './tx';

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
  db: Tx,
  selection: SQL,
): Promise<readonly RatingCandidate[]> => {
  const rows = (await db.execute(sql`select ${endingColumns},
      r.competition_type as "competitionType",
      case when r.ladder_id is null then null else jsonb_build_object('style', r.ladder_id, 'division', r.ladder_division) end as ladder,
      exists(select 1 from rating_changes l where l.round_id=r.id) as "alreadyRated"
    from rounds r ${recordedEndingJoins}
    where (r.room_id is null or exists(select 1 from rooms rating_room join lobbies rating_lobby on rating_lobby.id=rating_room.lobby_id where rating_room.id=r.room_id and rating_lobby.owner_organization_id=${daisyOrganizationId})) and ${selection}`)) as unknown as FactsRow[];
  return rows.map(endingFacts);
};

/**
 * The ending facts of these Rounds, the same Daisy's ratings read, for a
 * ladder outside Daisy's own (a league's) to ask `endingRating` of.
 */
const endingReadBatch = 10_000;

export async function readEndingRatingFacts(
  db: Tx,
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
  db: Tx,
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
  db: Tx,
  roundId: string,
): Promise<RatingEligibilityFacts | null> {
  if (!idSchema.safeParse(roundId).success) throw createAppError('VALIDATION');
  const [candidate] = await readCandidates(db, sql`r.id=${roundId}`);
  if (candidate?.facts === null) throw candidate.unreadable;
  return candidate?.facts ?? null;
}
