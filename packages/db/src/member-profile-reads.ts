import { createAppError } from '@daisy/errors';
import {
  debateSides,
  type DebateRole,
  type RatedOutcome,
  type RoundStatus,
} from '@daisy/protocol';
import {
  and,
  count,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  or,
  sql,
} from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { actors } from './schema/actors';
import { botProfiles } from './schema/bot-profiles';
import { roundAttendanceAdjudications } from './schema/round-attendance';
import { roundCommands } from './schema/round-commands';
import { roundParticipants } from './schema/round-participants';
import { rounds } from './schema/rounds';
import { users } from './schema/users';

/**
 * The profile's reads (ISSUE-600): who a member is, their Rounds grouped for
 * the record, and one page of their completed Rounds. Rows only: what a
 * Round means for the record is the domain's `recordResult`.
 */

/** A live member with a claimed name; a tombstone has none. */
type MemberRow = {
  readonly userId: string;
  readonly actorId: string;
  readonly username: string;
  readonly memberSince: string;
};

/** The member's debating Rounds, counted per state, outcome and side. */
type RecordGroup = {
  readonly status: RoundStatus;
  readonly outcome: RatedOutcome | null;
  readonly role: DebateRole;
  readonly rounds: number;
};

type HistorySeat = {
  readonly role: DebateRole;
  readonly kind: 'human' | 'bot';
  /** Null for a member who has left Daisy. */
  readonly label: string | null;
};

type HistoryRow = {
  readonly roundId: string;
  readonly completedAt: string;
  readonly resolution: string;
  readonly visibility: 'public' | 'unlisted' | 'private';
  readonly outcome: RatedOutcome | null;
  readonly role: 'affirmative' | 'negative';
  readonly forfeit: boolean;
  readonly seats: readonly HistorySeat[];
};

export type MatchHistoryPage = {
  readonly rows: readonly HistoryRow[];
  /** The last row's Round when an older page exists. */
  readonly nextBefore: string | null;
};

const debating = inArray(roundParticipants.role, [...debateSides]);
const readOnly = {
  isolationLevel: 'repeatable read',
  accessMode: 'read only',
} as const;

export const memberProfileReadOperations = ({
  database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  /** The live member a username names, or null. */
  readMember(username: string): Promise<MemberRow | null> {
    return instrumented(eventSink, 'readMember', async () => {
      const [row] = await database
        .select({
          userId: users.id,
          actorId: actors.id,
          username: users.username,
          createdAt: users.createdAt,
        })
        .from(users)
        .innerJoin(
          actors,
          and(eq(actors.userId, users.id), eq(actors.kind, 'human')),
        )
        .where(
          and(
            sql`lower(${users.username}) = lower(${username})`,
            isNull(users.deletedAt),
          ),
        )
        .limit(1);
      return row?.username
        ? {
            userId: row.userId,
            actorId: row.actorId,
            username: row.username,
            memberSince: row.createdAt.toISOString(),
          }
        : null;
    });
  },

  /** Every debating seat the actor held, grouped for the record's tally. */
  readRecordGroups(actorId: string): Promise<readonly RecordGroup[]> {
    return instrumented(eventSink, 'readRecordGroups', async () => {
      const rows = await database
        .select({
          status: rounds.status,
          outcome: rounds.outcome,
          role: roundParticipants.role,
          rounds: count(),
        })
        .from(roundParticipants)
        .innerJoin(rounds, eq(rounds.id, roundParticipants.roundId))
        .where(and(eq(roundParticipants.actorId, actorId), debating))
        .groupBy(rounds.status, rounds.outcome, roundParticipants.role);
      return rows.map((row) => ({
        status: row.status,
        outcome: row.outcome,
        role: row.role as DebateRole,
        rounds: row.rounds,
      }));
    });
  },

  /**
   * One page of the actor's completed debating Rounds, newest first, keyed
   * on (completed_at, id) so a page never repeats or skips a Round. With
   * `publicOnly` only public Rounds are listed. A `before` Round outside
   * that list is refused, so the cursor cannot probe other Rounds.
   */
  readMatchHistory(input: {
    readonly actorId: string;
    readonly publicOnly: boolean;
    readonly before: string | null;
    readonly limit: number;
  }): Promise<MatchHistoryPage> {
    if (
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 50
    )
      throw createAppError('VALIDATION');
    return instrumented(eventSink, 'readMatchHistory', () =>
      database.transaction(async (tx) => {
        const listed = and(
          eq(roundParticipants.actorId, input.actorId),
          debating,
          eq(rounds.status, 'completed'),
          input.publicOnly ? eq(rounds.visibility, 'public') : undefined,
        );
        const cursor =
          input.before === null
            ? undefined
            : await (async () => {
                const [found] = await tx
                  .select({ completedAt: rounds.completedAt, id: rounds.id })
                  .from(roundParticipants)
                  .innerJoin(rounds, eq(rounds.id, roundParticipants.roundId))
                  .where(and(listed, eq(rounds.id, input.before!)))
                  .limit(1);
                if (!found?.completedAt) throw createAppError('VALIDATION');
                return or(
                  lt(rounds.completedAt, found.completedAt),
                  and(
                    eq(rounds.completedAt, found.completedAt),
                    lt(rounds.id, found.id),
                  ),
                );
              })();
        const page = await tx
          .select({
            roundId: rounds.id,
            completedAt: rounds.completedAt,
            resolution: rounds.resolution,
            visibility: rounds.visibility,
            outcome: rounds.outcome,
            role: roundParticipants.role,
          })
          .from(roundParticipants)
          .innerJoin(rounds, eq(rounds.id, roundParticipants.roundId))
          .where(and(listed, cursor))
          .orderBy(desc(rounds.completedAt), desc(rounds.id))
          .limit(input.limit + 1);
        const shown = page.slice(0, input.limit);
        const ids = shown.map((row) => row.roundId);
        const seats =
          ids.length === 0
            ? []
            : await tx
                .select({
                  roundId: roundParticipants.roundId,
                  role: roundParticipants.role,
                  kind: actors.kind,
                  username: users.username,
                  botName: botProfiles.name,
                })
                .from(roundParticipants)
                .innerJoin(actors, eq(actors.id, roundParticipants.actorId))
                .leftJoin(users, eq(users.id, actors.userId))
                .leftJoin(botProfiles, eq(botProfiles.actorId, actors.id))
                .where(inArray(roundParticipants.roundId, ids))
                .orderBy(roundParticipants.role, roundParticipants.slot);
        const forfeited = new Set(
          ids.length === 0
            ? []
            : [
                ...(await tx
                  .select({ roundId: roundCommands.roundId })
                  .from(roundCommands)
                  .where(
                    and(
                      inArray(roundCommands.roundId, ids),
                      eq(roundCommands.type, 'forfeit'),
                    ),
                  )),
                ...(await tx
                  .select({ roundId: roundAttendanceAdjudications.roundId })
                  .from(roundAttendanceAdjudications)
                  .where(
                    and(
                      inArray(roundAttendanceAdjudications.roundId, ids),
                      eq(roundAttendanceAdjudications.decision, 'forfeit'),
                    ),
                  )),
              ].map((row) => row.roundId),
        );
        return {
          rows: shown.map((row) => {
            if (
              !row.completedAt ||
              (row.role !== 'affirmative' && row.role !== 'negative')
            )
              throw createAppError(
                'INTERNAL',
                'A listed Round is not complete',
              );
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
                  kind:
                    seat.kind === 'bot' ? ('bot' as const) : ('human' as const),
                  label:
                    seat.kind === 'bot'
                      ? (seat.botName ?? null)
                      : (seat.username ?? null),
                })),
            };
          }),
          nextBefore:
            page.length > input.limit ? (shown.at(-1)?.roundId ?? null) : null,
        };
      }, readOnly),
    );
  },
});
