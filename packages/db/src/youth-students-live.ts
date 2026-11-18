import { runningRoundStatuses } from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { isDebatingSeatSql } from './seat-columns';
import { currentTenantScope, scopeTransaction } from './tenant-scope';

type Tx = Pick<BunSQLDatabase, 'execute'>;

/** A running Youth Round one of the adult's students debates in, and its Room's title. */
export type StudentLiveRound = {
  readonly roundId: string;
  readonly title: string;
};

const rows = async <Row>(tx: Tx, query: ReturnType<typeof sql>) =>
  (await tx.execute(query)) as unknown as Row[];

/**
 * The live Youth Rounds an adult may be watching for (ADR 0155), the other
 * way round from `readLinkedAdultUserIds`: the minors they hold an active
 * guardian link to, and the members of each school they own or belong to,
 * each read under its own scope; then the running Youth Rounds seating any of
 * them as a debater. These are candidates only: whether the adult watches one
 * is the live audience rule's, on that Round's own linked adults. The
 * caller's scope comes back at the end.
 */
export const readStudentLiveRoundCandidates = async (
  tx: Tx,
  adultUserId: string,
): Promise<readonly StudentLiveRound[]> => {
  const caller = await currentTenantScope(tx);
  await scopeTransaction(tx, { subjectUserId: adultUserId });
  const minors = await rows<{ user_id: string }>(
    tx,
    sql`select g.minor_user_id as user_id from guardian_links g
      where g.guardian_user_id = ${adultUserId} and g.status = 'active'`,
  );
  const schools = await rows<{ organization_id: string }>(
    tx,
    sql`select o.id as organization_id from organizations o
        where o.kind = 'school' and o.closed_at is null
          and o.owner_user_id = ${adultUserId}
      union
      select m.organization_id from memberships m
        join organizations o on o.id = m.organization_id
        where m.user_id = ${adultUserId} and m.status = 'active'
          and o.kind = 'school' and o.closed_at is null`,
  );
  const members: string[] = [];
  for (const { organization_id: organizationId } of schools) {
    await scopeTransaction(tx, { organizationId });
    const found = await rows<{ user_id: string }>(
      tx,
      sql`select m.user_id from memberships m
        where m.organization_id = ${organizationId} and m.status = 'active'`,
    );
    members.push(...found.map((row) => row.user_id));
  }
  await scopeTransaction(tx, caller);
  const students = [
    ...new Set([...minors.map((row) => row.user_id), ...members]),
  ].filter((userId) => userId !== adultUserId);
  if (students.length === 0) return [];
  const live = await rows<{ id: string; title: string }>(
    tx,
    sql`select distinct r.id, rm.title from rounds r
      join rooms rm on rm.id = r.room_id
      join round_participants p on p.round_id = r.id
        and ${isDebatingSeatSql(sql`p.seat_kind`)}
        and public.daisy_round_participant_is_current(p.id)
      join actors a on a.id = p.actor_id
      where r.competition_type = 'ranked' and r.ladder_division = 'youth'
        and r.status in (${sql.join(
          runningRoundStatuses.map((status) => sql`${status}`),
          sql`, `,
        )})
        and a.user_id in (${sql.join(
          students.map((userId) => sql`${userId}`),
          sql`, `,
        )})
      order by r.id
      limit 50`,
  );
  return live.map((row) => ({ roundId: row.id, title: row.title }));
};

/** The same read in its own read-only snapshot, so its scopes reach no other read. */
export const readStudentLiveRounds = (
  database: Pick<BunSQLDatabase, 'transaction'>,
  adultUserId: string,
) =>
  database.transaction(
    (tx) => readStudentLiveRoundCandidates(tx, adultUserId),
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
