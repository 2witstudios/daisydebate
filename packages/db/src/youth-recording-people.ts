import { sql } from 'drizzle-orm';
import { rowsOf } from './raw-rows';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { isDebatingSeatSql } from './seat-columns';
import { currentTenantScope, scopeTransaction } from './tenant-scope';

/** A connection or a transaction: each read below runs on the caller's. */
type Tx = Pick<BunSQLDatabase, 'execute'>;

/** Only an adult with a valid age record stands in for a youth debater. */
const adultUser = (userId: ReturnType<typeof sql>) =>
  sql`exists (select 1 from account_age a where a.user_id = ${userId}
    and public.daisy_age_band(a.birth_month, a.version, a.recorded_at, clock_timestamp()) = 'adult')`;

/**
 * The adults linked to one youth debater (ADR 0107, PYL-5): an active guardian
 * link (a parent, or a coach through a school), and the staff of each school
 * they belong to, its owner or a member holding a live grant whose role carries
 * `school.roster.manage`. Each relation is read under its own scope: the
 * debater's own rows under the subject scope, each school's under its own.
 */
export const readLinkedAdultUserIds = async (
  tx: Tx,
  debaterUserId: string,
): Promise<readonly string[]> => {
  // Each step sets its own scope; the caller's comes back at the end.
  const caller = await currentTenantScope(tx);
  await scopeTransaction(tx, { subjectUserId: debaterUserId });
  const guardians = await rowsOf<{ user_id: string }>(
    tx,
    sql`select g.guardian_user_id as user_id from guardian_links g
      where g.minor_user_id = ${debaterUserId} and g.status = 'active'
        and ${adultUser(sql`g.guardian_user_id`)}`,
  );
  const schools = await rowsOf<{ organization_id: string }>(
    tx,
    sql`select m.organization_id from memberships m
      join organizations o on o.id = m.organization_id
      where m.user_id = ${debaterUserId} and m.status = 'active'
        and o.kind = 'school' and o.closed_at is null`,
  );
  const staff: string[] = [];
  for (const { organization_id: organizationId } of schools) {
    await scopeTransaction(tx, { organizationId });
    const found = await rowsOf<{ user_id: string }>(
      tx,
      sql`select o.owner_user_id as user_id from organizations o
        where o.id = ${organizationId} and o.owner_user_id is not null
          and ${adultUser(sql`o.owner_user_id`)}
        union
        select g.user_id from grants g
        join memberships m on m.organization_id = g.organization_id
          and m.user_id = g.user_id and m.status = 'active'
        where g.organization_id = ${organizationId}
          and g.scope_kind = 'organization'
          and g.revoked_at is null
          and (g.expires_at is null or g.expires_at > clock_timestamp())
          and exists (select 1 from role_permissions p
            where p.role_id = g.role_id and p.permission = 'school.roster.manage')
          and ${adultUser(sql`g.user_id`)}`,
    );
    staff.push(...found.map((row) => row.user_id));
  }
  await scopeTransaction(tx, caller);
  return [
    ...new Set([...guardians.map((row) => row.user_id), ...staff]),
  ].filter((userId) => userId !== debaterUserId);
};

/**
 * A Youth Round's youth debaters and the actors of their linked adults. The
 * caller has read the Round as a Youth one: ranked on Youth – Freestyle for
 * its Recording (ADR 0150), or in a Youth Room for its live audience
 * (ADR 0156). Its Recording and its live audience read this to decide who
 * may see the Round, and neither writes any of it.
 */
export const readYouthRecordingPeople = async (tx: Tx, roundId: string) => {
  const debaters = await rowsOf<{ actor_id: string; user_id: string }>(
    tx,
    sql`select distinct p.actor_id, a.user_id from round_participants p
        join actors a on a.id = p.actor_id
        where p.round_id = ${roundId} and ${isDebatingSeatSql(sql`p.seat_kind`)}
          and public.daisy_round_participant_is_current(p.id)
          and a.user_id is not null
        order by p.actor_id`,
  );
  const people = [];
  for (const debater of debaters) {
    const adults = await readLinkedAdultUserIds(tx, debater.user_id);
    const actors =
      adults.length === 0
        ? []
        : await rowsOf<{ id: string }>(
            tx,
            sql`select id from actors where user_id in (${sql.join(
              adults.map((userId) => sql`${userId}`),
              sql`, `,
            )}) order by id`,
          );
    people.push({
      actorId: debater.actor_id,
      userId: debater.user_id,
      linkedAdultActorIds: actors.map((actor) => actor.id),
    });
  }
  return { debaters: people };
};

/**
 * The same read in its own read-only snapshot, so the scopes it sets never
 * reach another read and a school's staff and the debater's membership agree.
 * Recording, the web's live reads and the realtime server all call this
 * (ADR 0150, ADR 0155).
 */
export const readYouthRoundPeople = (
  database: Pick<BunSQLDatabase, 'transaction'>,
  roundId: string,
) =>
  database.transaction((tx) => readYouthRecordingPeople(tx, roundId), {
    isolationLevel: 'repeatable read',
    accessMode: 'read only',
  });
