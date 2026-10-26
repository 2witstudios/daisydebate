import { createAppError } from '@daisy/errors';
import type { DebateRole, RatedOutcome, RoundStatus } from '@daisy/protocol';
import { and, count, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { debating, historyRows, type HistoryRow } from './member-history-rows';
import { sharedAccount, type Account, type Caller } from './room-command-facts';
import { actors } from './schema/actors';
import { roundParticipants } from './schema/round-participants';
import { rounds } from './schema/rounds';
import { users } from './schema/users';

/**
 * The profile's read (ISSUE-600): who a member is, their Rounds grouped for
 * the record, and one page of their completed Rounds, in one snapshot. Rows
 * only: what a Round means for the record is the domain's `recordResult`,
 * and which Rounds the viewer may see is the caller's authorization decision.
 */

type Tx = Pick<BunSQLDatabase, 'select' | 'execute'>;

/** Which of the member's Rounds the viewer may see. */
export type HistoryScope = 'owner' | 'public';

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

export type MemberProfileRead = {
  readonly member: MemberRow;
  readonly scope: HistoryScope;
  readonly groups: readonly RecordGroup[];
  readonly rows: readonly HistoryRow[];
  /** The last row's Round when an older page exists. */
  readonly nextBefore: string | null;
};

const readOnly = {
  isolationLevel: 'repeatable read',
  accessMode: 'read only',
} as const;

/** The live member a username names; a tombstone has no name. */
async function memberRow(tx: Tx, username: string): Promise<MemberRow | null> {
  const [row] = await tx
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
}

/**
 * The member's debating seats in Rounds the scope shows: played from a Room
 * (a room-less service Round has no page to link to), and public only
 * outside the owner's scope. The tally and the history use this one filter.
 */
const seatsShown = (actorId: string, scope: HistoryScope) =>
  and(
    eq(roundParticipants.actorId, actorId),
    debating,
    isNotNull(rounds.roomId),
    scope === 'owner' ? undefined : eq(rounds.visibility, 'public'),
  );

const recordGroups = async (
  tx: Tx,
  actorId: string,
  scope: HistoryScope,
): Promise<readonly RecordGroup[]> =>
  (
    await tx
      .select({
        status: rounds.status,
        outcome: rounds.outcome,
        role: roundParticipants.role,
        rounds: count(),
      })
      .from(roundParticipants)
      .innerJoin(rounds, eq(rounds.id, roundParticipants.roundId))
      .where(seatsShown(actorId, scope))
      .groupBy(rounds.status, rounds.outcome, roundParticipants.role)
  ).map((row) => ({ ...row, role: row.role as DebateRole }));

/**
 * One page of completed Rounds, newest first, keyed on (completed_at, id) so
 * a page never repeats or skips a Round. A `before` Round outside the scope's
 * list is refused, so the cursor cannot probe other Rounds.
 */
async function historyPage(
  tx: Tx,
  input: {
    readonly actorId: string;
    readonly scope: HistoryScope;
    readonly before: string | null;
    readonly limit: number;
  },
) {
  const listed = and(
    seatsShown(input.actorId, input.scope),
    eq(rounds.status, 'completed'),
  );
  if (input.before !== null) {
    const [found] = await tx
      .select({ id: rounds.id })
      .from(roundParticipants)
      .innerJoin(rounds, eq(rounds.id, roundParticipants.roundId))
      .where(and(listed, eq(rounds.id, input.before)))
      .limit(1);
    if (!found) throw createAppError('VALIDATION');
  }
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
    .where(
      and(
        listed,
        input.before === null
          ? undefined
          : // Compared in SQL: a JS Date would drop the column's microseconds.
            sql`(${rounds.completedAt}, ${rounds.id}) < (select c.completed_at, c.id from rounds c where c.id = ${input.before})`,
      ),
    )
    .orderBy(desc(rounds.completedAt), desc(rounds.id))
    .limit(input.limit + 1);
  const shown = page.slice(0, input.limit);
  return {
    rows: await historyRows(tx, shown),
    nextBefore:
      page.length > input.limit ? (shown.at(-1)?.roundId ?? null) : null,
  };
}

export const memberProfileReadOperations = ({
  database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  /**
   * A member's profile rows in one read-only snapshot, or null when no live
   * member holds the name. The viewer's account is read fresh under the
   * shared account fence in that snapshot, and `decide` maps it, with the
   * member's actor, to the scope both the tally and the history read.
   */
  readMemberProfile(input: {
    readonly username: string;
    readonly caller: Caller | null;
    readonly decide: (
      memberActorId: string,
      account: Account | null,
    ) => HistoryScope;
    readonly before: string | null;
    readonly limit: number;
  }): Promise<MemberProfileRead | null> {
    if (
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 50
    )
      throw createAppError('VALIDATION');
    return instrumented(eventSink, 'readMemberProfile', () =>
      database.transaction(async (tx) => {
        const member = await memberRow(tx, input.username);
        if (member === null) return null;
        const account =
          input.caller === null ? null : await sharedAccount(tx, input.caller);
        const scope = input.decide(member.actorId, account);
        return {
          member,
          scope,
          groups: await recordGroups(tx, member.actorId, scope),
          ...(await historyPage(tx, {
            actorId: member.actorId,
            scope,
            before: input.before,
            limit: input.limit,
          })),
        };
      }, readOnly),
    );
  },
});
