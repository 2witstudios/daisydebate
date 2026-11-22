import { runningRoundStatuses } from '@daisy/protocol/round';
import { sql } from 'drizzle-orm';
import { query } from './raw-rows';
import { currentTenantScope, scopeTransaction } from './tenant-scope';
import { inTransaction, type Tx, type TxOpener } from './tx';
import { z } from 'zod';
import { youthRoundSql } from './youth-round-sql';

/** At most this many: the newest running Rounds first. Watch shows a handful. */
const STUDENT_LIVE_ROUNDS = 12;

/** A running Youth Round one of the adult's students debates in, and its Room's title. */
export type StudentLiveRound = {
  readonly roundId: string;
  readonly title: string;
};

/**
 * The live Youth Rounds an adult may be watching for (ADR 0155), the other
 * way round from `readLinkedAdultUserIds` and with its staff rule: the minors
 * they hold an active guardian link to, and the members of each school they
 * own or staff (an active member holding a live grant whose role carries
 * `school.roster.manage`), each read under its own scope; then the running
 * Youth Rounds, including a frozen youth cast in a mixed-age lobby, seating
 * any of them as a debater. These are candidates only: whether the adult watches one
 * is the live audience rule's, on that Round's own linked adults. The
 * caller's scope comes back at the end.
 */
const readStudentLiveRoundCandidates = async (
  tx: Tx,
  adultUserId: string,
  lobbyId?: string,
): Promise<readonly StudentLiveRound[]> => {
  // Only an adult with a valid age record stands in for a youth debater,
  // the forward rule's own test: nobody else has students to look for.
  const [adult] = await query(
    tx,
    z.object({ adult: z.boolean() }),
    sql`select exists (select 1 from account_age a where a.user_id = ${adultUserId}
      and public.daisy_age_band(a.birth_month, a.version, a.recorded_at, clock_timestamp()) = 'adult') as adult`,
  );
  if (adult?.adult !== true) return [];
  const caller = await currentTenantScope(tx);
  await scopeTransaction(tx, { subjectUserId: adultUserId });
  const minors = await query(
    tx,
    z.object({ user_id: z.string() }),
    sql`select g.minor_user_id as user_id from guardian_links g
      where g.guardian_user_id = ${adultUserId} and g.status = 'active'`,
  );
  const schools = await query(
    tx,
    z.object({ organization_id: z.string(), owner: z.boolean() }),
    sql`select o.id as organization_id, true as owner from organizations o
        where o.kind = 'school' and o.closed_at is null
          and o.owner_user_id = ${adultUserId}
      union
      select m.organization_id, false as owner from memberships m
        join organizations o on o.id = m.organization_id
        where m.user_id = ${adultUserId} and m.status = 'active'
          and o.kind = 'school' and o.closed_at is null
          and o.owner_user_id is distinct from ${adultUserId}`,
  );
  const members: string[] = [];
  for (const { organization_id: organizationId, owner } of schools) {
    await scopeTransaction(tx, { organizationId });
    // A member who is not staff has no students here (the forward rule's own test).
    if (!owner) {
      const [staff] = await query(
        tx,
        z.object({ staff: z.boolean() }),
        sql`select exists (select 1 from grants g
          where g.organization_id = ${organizationId} and g.user_id = ${adultUserId}
            and g.scope_kind = 'organization' and g.revoked_at is null
            and (g.expires_at is null or g.expires_at > clock_timestamp())
            and exists (select 1 from role_permissions p
              where p.role_id = g.role_id and p.permission = 'school.roster.manage')) as staff`,
      );
      if (staff?.staff !== true) continue;
    }
    const found = await query(
      tx,
      z.object({ user_id: z.string() }),
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
  const live = await query(
    tx,
    z.object({ id: z.string(), title: z.string() }),
    sql`select r.id, rm.title from rounds r
      join rooms rm on rm.id = r.room_id
      where ${youthRoundSql(sql`r.id`)}
        and ${lobbyId === undefined ? sql`true` : sql`(rm.lobby_id=${lobbyId} or rm.lobby_kind='tournament')`}
        and r.status in (${sql.join(
          runningRoundStatuses.map((status) => sql`${status}`),
          sql`, `,
        )})
        and exists (select 1 from public.daisy_round_linked_adult_actors(r.id) p
          where p.debater_user_id in (${sql.join(
            students.map((userId) => sql`${userId}`),
            sql`, `,
          )}))
      order by r.started_at desc nulls last, r.id
      limit ${STUDENT_LIVE_ROUNDS}`,
  );
  return live.map((row) => ({ roundId: row.id, title: row.title }));
};

/** The same read in its own read-only snapshot, so its scopes reach no other read. */
export const readStudentLiveRounds = (
  database: TxOpener,
  adultUserId: string,
  lobbyId?: string,
) =>
  inTransaction(
    database,
    (tx) => readStudentLiveRoundCandidates(tx, adultUserId, lobbyId),
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
