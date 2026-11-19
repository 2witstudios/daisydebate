import { createAppError } from '@daisy/errors';
import {
  isDebatingSeat,
  ratingDivisions,
  ratingStyles,
  type Ladder,
  type RoundOutcome,
  type SeatRef,
} from '@daisy/protocol';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { actors } from './schema/actors';
import { botProfiles } from './schema/bot-profiles';
import { aiJudgeProfiles } from './schema/ai-judge-profiles';
import { forfeitRecorded } from './recorded-ending';
import { roundParticipants } from './schema/round-participants';
import { rounds } from './schema/rounds';
import { users } from './schema/users';
import {
  isDebatingSeatSql,
  seatOfColumns,
  seatRowOrder,
  type SeatColumns,
} from './seat-columns';
import type { Tx } from './tx';

/** A competitor's seat: a side's or an unsided speaker's. */
export const debating = isDebatingSeatSql(roundParticipants.seatKind);

type HistorySeat = {
  readonly seat: SeatRef;
  readonly kind: 'human' | 'bot';
  /** Null only for a seat with no name on record. */
  readonly label: string | null;
  /** A member whose account is closed: their name stays on the record (ADR 0087). */
  readonly closed: boolean;
};

export type HistoryRow = {
  readonly roundId: string;
  readonly completedAt: string;
  /** Null when the Round ended before its reveal. */
  readonly resolution: string | null;
  readonly visibility: 'public' | 'unlisted' | 'private';
  readonly outcome: RoundOutcome | null;
  /** The member's own seat: always a competitor's. */
  readonly seat: SeatRef;
  readonly forfeit: boolean;
  readonly seats: readonly HistorySeat[];
  /** The ladder a ranked Round rated on (ADR 0147); null for a casual one. */
  readonly ladder: Ladder | null;
};

/** One listed Round as the page query selects it. */
export type ListedRound = {
  readonly roundId: string;
  readonly completedAt: Date | null;
  /** Null when the Round ended before its reveal. */
  readonly resolution: string | null;
  readonly visibility: 'public' | 'unlisted' | 'private' | null;
  readonly outcome: RoundOutcome | null;
  readonly seat: SeatColumns;
};

/** The Rounds a forfeit decided, by command or by attendance. */
const forfeitedRounds = async (tx: Tx, ids: readonly string[]) => {
  const rows = await tx.execute(sql`select z.round_id as "roundId"
    from round_finalizations z
    where z.round_id in (${sql.join(
      ids.map((id) => sql`${id}`),
      sql`,`,
    )}) and ${forfeitRecorded}`);
  return new Set(
    (rows as unknown as { roundId: string }[]).map((r) => r.roundId),
  );
};

/**
 * A Round's ladder from its frozen columns: both set on a ranked Round, both
 * null otherwise (`rounds_ladder_division_check`). A value outside the
 * vocabulary names no ladder Daisy shows.
 */
export const roundLadderOf = (columns: {
  readonly ladderId: string | null;
  readonly ladderDivision: string | null;
}): Ladder | null => {
  const style = ratingStyles.find((each) => each === columns.ladderId);
  const division = ratingDivisions.find(
    (each) => each === columns.ladderDivision,
  );
  return style === undefined || division === undefined
    ? null
    : { style, division };
};

/** Each listed Round's ladder, by id. */
const roundLadders = async (
  tx: Tx,
  ids: readonly string[],
): Promise<ReadonlyMap<string, Ladder | null>> => {
  const rows = await tx
    .select({
      roundId: rounds.id,
      ladderId: rounds.ladderId,
      ladderDivision: rounds.ladderDivision,
    })
    .from(rounds)
    .where(inArray(rounds.id, ids));
  return new Map(rows.map((row) => [row.roundId, roundLadderOf(row)]));
};

/**
 * Every seat of each listed Round, named, in seat order. A judge's name is
 * never read: only its kind names the panel.
 */
export async function namedSeats(
  tx: Tx,
  ids: readonly string[],
): Promise<ReadonlyMap<string, readonly HistorySeat[]>> {
  if (ids.length === 0) return new Map();
  const seats = await tx
    .select({
      roundId: roundParticipants.roundId,
      seatKind: roundParticipants.seatKind,
      side: roundParticipants.side,
      slot: roundParticipants.slot,
      kind: actors.kind,
      username: users.username,
      closedAt: users.deletedAt,
      botName: sql<
        string | null
      >`coalesce(${botProfiles.name}, ${aiJudgeProfiles.name})`,
    })
    .from(roundParticipants)
    .innerJoin(actors, eq(actors.id, roundParticipants.actorId))
    .leftJoin(users, and(eq(users.id, actors.userId), debating))
    .leftJoin(botProfiles, eq(botProfiles.actorId, actors.id))
    .leftJoin(aiJudgeProfiles, eq(aiJudgeProfiles.actorId, actors.id))
    .where(inArray(roundParticipants.roundId, ids))
    .orderBy(...seatRowOrder(roundParticipants));
  return new Map(
    ids.map((id) => [
      id,
      seats
        .filter((seat) => seat.roundId === id)
        .map((seat) => ({
          seat: seatOfColumns(seat),
          kind: seat.kind === 'bot' ? ('bot' as const) : ('human' as const),
          label:
            seat.kind === 'bot'
              ? (seat.botName ?? null)
              : (seat.username ?? null),
          closed: seat.kind !== 'bot' && seat.closedAt !== null,
        })),
    ]),
  );
}

/** The listed Rounds with every seat and whether a forfeit decided them. */
export async function historyRows(
  tx: Tx,
  listed: readonly ListedRound[],
): Promise<readonly HistoryRow[]> {
  const ids = listed.map((row) => row.roundId);
  if (ids.length === 0) return [];
  const seats = await namedSeats(tx, ids);
  const forfeited = await forfeitedRounds(tx, ids);
  const ladders = await roundLadders(tx, ids);
  return listed.map((row) => {
    const own = seatOfColumns(row.seat);
    if (!row.completedAt || !isDebatingSeat(own))
      throw createAppError('INTERNAL', 'A listed Round is not complete');
    return {
      roundId: row.roundId,
      completedAt: row.completedAt.toISOString(),
      resolution: row.resolution,
      visibility: row.visibility ?? 'private',
      outcome: row.outcome,
      seat: own,
      forfeit: forfeited.has(row.roundId),
      seats: seats.get(row.roundId) ?? [],
      ladder: ladders.get(row.roundId) ?? null,
    };
  });
}
