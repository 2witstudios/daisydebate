import { createAppError } from '@daisy/errors';
import {
  debateSides,
  type DebateRole,
  type RatedOutcome,
} from '@daisy/protocol';
import { and, eq, inArray } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { actors } from './schema/actors';
import { botProfiles } from './schema/bot-profiles';
import { roundAttendanceAdjudications } from './schema/round-attendance';
import { roundCommands } from './schema/round-commands';
import { roundParticipants } from './schema/round-participants';
import { users } from './schema/users';

type Tx = Pick<BunSQLDatabase, 'select'>;

export const debating = inArray(roundParticipants.role, [...debateSides]);

type HistorySeat = {
  readonly role: DebateRole;
  readonly kind: 'human' | 'bot';
  /** Null for a member who has left Daisy. */
  readonly label: string | null;
};

export type HistoryRow = {
  readonly roundId: string;
  readonly completedAt: string;
  readonly resolution: string;
  readonly visibility: 'public' | 'unlisted' | 'private';
  readonly outcome: RatedOutcome | null;
  readonly role: 'affirmative' | 'negative';
  readonly forfeit: boolean;
  readonly seats: readonly HistorySeat[];
};

/** One listed Round as the page query selects it. */
export type ListedRound = {
  readonly roundId: string;
  readonly completedAt: Date | null;
  readonly resolution: string;
  readonly visibility: 'public' | 'unlisted' | 'private' | null;
  readonly outcome: RatedOutcome | null;
  readonly role: string;
};

/** The Rounds a forfeit decided, by command or by attendance. */
const forfeitedRounds = async (tx: Tx, ids: readonly string[]) =>
  new Set(
    [
      ...(await tx
        .select({ roundId: roundCommands.roundId })
        .from(roundCommands)
        .where(
          and(
            inArray(roundCommands.roundId, [...ids]),
            eq(roundCommands.type, 'forfeit'),
          ),
        )),
      ...(await tx
        .select({ roundId: roundAttendanceAdjudications.roundId })
        .from(roundAttendanceAdjudications)
        .where(
          and(
            inArray(roundAttendanceAdjudications.roundId, [...ids]),
            eq(roundAttendanceAdjudications.decision, 'forfeit'),
          ),
        )),
    ].map((row) => row.roundId),
  );

/**
 * The listed Rounds with every seat and whether a forfeit decided them. A
 * judge's name is never read: only its kind names the panel.
 */
export async function historyRows(
  tx: Tx,
  listed: readonly ListedRound[],
): Promise<readonly HistoryRow[]> {
  const ids = listed.map((row) => row.roundId);
  if (ids.length === 0) return [];
  const seats = await tx
    .select({
      roundId: roundParticipants.roundId,
      role: roundParticipants.role,
      kind: actors.kind,
      username: users.username,
      botName: botProfiles.name,
    })
    .from(roundParticipants)
    .innerJoin(actors, eq(actors.id, roundParticipants.actorId))
    .leftJoin(users, and(eq(users.id, actors.userId), debating))
    .leftJoin(botProfiles, eq(botProfiles.actorId, actors.id))
    .where(inArray(roundParticipants.roundId, ids))
    .orderBy(roundParticipants.role, roundParticipants.slot);
  const forfeited = await forfeitedRounds(tx, ids);
  return listed.map((row) => {
    if (
      !row.completedAt ||
      (row.role !== 'affirmative' && row.role !== 'negative')
    )
      throw createAppError('INTERNAL', 'A listed Round is not complete');
    return {
      roundId: row.roundId,
      completedAt: row.completedAt.toISOString(),
      resolution: row.resolution,
      visibility: row.visibility ?? 'private',
      outcome: row.outcome,
      role: row.role,
      forfeit: forfeited.has(row.roundId),
      seats: seats
        .filter((seat) => seat.roundId === row.roundId)
        .map((seat) => ({
          role: seat.role as DebateRole,
          kind: seat.kind === 'bot' ? ('bot' as const) : ('human' as const),
          label:
            seat.kind === 'bot'
              ? (seat.botName ?? null)
              : (seat.username ?? null),
        })),
    };
  });
}
