import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import {
  decideClubConfirm,
  releaseStandingOf,
  type ClubConfirmDecision,
  type ReleaseStanding,
} from '@daisy/protocol/media-release';
import { sql } from 'drizzle-orm';
import type { BoundedTransaction } from './bounded-transaction';
import { readDatabaseTime } from './database-clock';
import {
  insertMediaRelease,
  readDivisionOf,
  readReleasesOf,
  readRequestsOf,
} from './media-release-records';
import { oweNotifications } from './notifications/owe';
import { isDebatingSeatSql } from './seat-columns';
import { divisionAgeBand, divisionOfBandSql } from './ladder-division-band';
import { scopeTransaction } from './tenant-scope';
import { youthRoundShareableSql, youthRoundSql } from './youth-round-sql';
import type { Tx } from './tx';
import { run as runStatement, query as queryRows } from './raw-rows';
import { z } from 'zod';

/** Who in a club may confirm its students' releases. */
export type ClubReleaseRole = 'owner' | 'staff';

type ClubRow = {
  id: string;
  name: string;
  handle: string;
  kind: 'school' | 'family';
  owner_user_id: string | null;
};

/**
 * A club's owner, or for a school its staff: an active member holding a live
 * organisation grant whose role carries `school.roster.manage` (ADR 0151).
 * A family club has only its owner. Read under the club's scope.
 */
async function clubReleaseRole(
  tx: Tx,
  club: ClubRow,
  userId: string,
): Promise<ClubReleaseRole | null> {
  if (club.owner_user_id === userId) return 'owner';
  if (club.kind !== 'school') return null;
  await scopeTransaction(tx, { organizationId: club.id });
  const [staff] = await queryRows(
    tx,
    z.object({ n: z.number() }),
    sql`select count(*)::int as n from grants g
      join memberships m on m.organization_id = g.organization_id
        and m.user_id = g.user_id and m.status = 'active'
      where g.organization_id = ${club.id} and g.user_id = ${userId}
        and g.scope_kind = 'organization' and g.revoked_at is null
        and (g.expires_at is null or g.expires_at > clock_timestamp())
        and exists (select 1 from role_permissions p
          where p.role_id = g.role_id and p.permission = 'school.roster.manage')`,
  );
  return (staff?.n ?? 0) > 0 ? 'staff' : null;
}

/** The owner and staff of a club: who hears that a student asked it. */
async function clubReleaseStaff(tx: Tx, club: ClubRow): Promise<string[]> {
  await scopeTransaction(tx, { organizationId: club.id });
  const staff =
    club.kind === 'school'
      ? await queryRows(
          tx,
          z.object({ user_id: z.string() }),
          sql`select distinct g.user_id from grants g
            join memberships m on m.organization_id = g.organization_id
              and m.user_id = g.user_id and m.status = 'active'
            where g.organization_id = ${club.id} and g.scope_kind = 'organization'
              and g.revoked_at is null
              and (g.expires_at is null or g.expires_at > clock_timestamp())
              and exists (select 1 from role_permissions p
                where p.role_id = g.role_id and p.permission = 'school.roster.manage')`,
        )
      : [];
  return [
    ...new Set([
      ...(club.owner_user_id === null ? [] : [club.owner_user_id]),
      ...staff.map((row) => row.user_id),
    ]),
  ];
}

const readClub = async (
  tx: Tx,
  by: { readonly handle: string } | { readonly id: string },
  lock: boolean,
): Promise<ClubRow | null> => {
  const [club] = await queryRows(
    tx,
    z.object({
      id: z.string(),
      name: z.string(),
      handle: z.string(),
      kind: z.enum(['school', 'family']),
      owner_user_id: z.string().nullable(),
    }),
    sql`select id, name, handle, kind, owner_user_id from organizations
      where ${'handle' in by ? sql`lower(handle) = lower(${by.handle})` : sql`id = ${by.id}`}
        and kind in ('school', 'family') and closed_at is null
      ${lock ? sql`for update` : sql``}`,
  );
  return club ?? null;
};

/** One Youth student of a club, as its release pages read them. */
export type ClubReleaseStudent = {
  readonly userId: string;
  readonly username: string | null;
  readonly joinedAt: string | null;
  readonly standing: ReleaseStanding;
  /** When the student asked this club to confirm, in the last 7 days. */
  readonly askedAt: string | null;
  /** Their Youth Rounds' Recordings: public now, and private. */
  readonly youthRounds: { readonly public: number; readonly private: number };
};

export type ClubReleasesRead = {
  readonly club: {
    readonly id: string;
    readonly name: string;
    readonly handle: string;
    readonly kind: 'school' | 'family';
  };
  readonly role: ClubReleaseRole;
  readonly students: readonly ClubReleaseStudent[];
};

const iso = (value: unknown) =>
  value === null || value === undefined
    ? null
    : new Date(value as string | Date).toISOString();

/** The active members of a club on Youth – Freestyle, with what the pages need. */
async function youthStudents(
  tx: Tx,
  club: ClubRow,
  nowMs: number,
  only?: readonly string[],
): Promise<ClubReleaseStudent[]> {
  await scopeTransaction(tx, { organizationId: club.id });
  const members = await queryRows(
    tx,
    z.object({
      user_id: z.string(),
      username: z.string().nullable(),
      joined_at: z.union([z.string(), z.date()]).nullable(),
    }),
    sql`select m.user_id, u.username, m.joined_at from memberships m
      join users u on u.id = m.user_id and u.deleted_at is null
      where m.organization_id = ${club.id} and m.status = 'active'
        ${
          only === undefined
            ? sql``
            : sql`and m.user_id in (${sql.join(
                only.map((id) => sql`${id}`),
                sql`, `,
              )})`
        }
      order by u.username nulls last, m.user_id
      limit 500`,
  );
  const asks = await queryRows(
    tx,
    z.object({
      user_id: z.string(),
      asked_at: z.union([z.string(), z.date()]),
    }),
    sql`select user_id, max(asked_at) as asked_at from media_release_club_asks
      where organization_id = ${club.id}
        and asked_at > clock_timestamp() - interval '7 days'
      group by user_id`,
  );
  const students: ClubReleaseStudent[] = [];
  for (const member of members) {
    if ((await readDivisionOf(tx, member.user_id)) !== 'youth') continue;
    const releases = await readReleasesOf(tx, [member.user_id], false);
    const requests = await readRequestsOf(tx, member.user_id, false);
    const [rounds] = await queryRows(
      tx,
      z.object({ public: z.number(), private: z.number() }),
      sql`select count(*) filter (where p.round_id is not null)::int as public,
          -- Only a Round a release could make public counts as waiting (ADR 0157).
          count(*) filter (where p.round_id is null and ${youthRoundShareableSql(sql`r`)})::int as private
        from rounds r
        join round_participants rp on rp.round_id = r.id
        join actors a on a.id = rp.actor_id
        join recordings rc on rc.round_id = r.id
        left join youth_round_publications p on p.round_id = r.id and p.ended_at is null
        where a.user_id = ${member.user_id} and ${youthRoundSql(sql`r.id`)}
          and ${isDebatingSeatSql(sql`rp.seat_kind`)}
          and public.daisy_round_participant_is_current(rp.id)`,
    );
    students.push({
      userId: member.user_id,
      username: member.username,
      joinedAt: iso(member.joined_at),
      standing: releaseStandingOf({
        subjectUserId: member.user_id,
        releases,
        requests,
        nowMs,
      }),
      askedAt: iso(
        asks.find((ask) => ask.user_id === member.user_id)?.asked_at,
      ),
      youthRounds: {
        public: rounds?.public ?? 0,
        private: rounds?.private ?? 0,
      },
    });
  }
  // Each read set its own scope; hand back the club's.
  await scopeTransaction(tx, { organizationId: club.id });
  return students;
}

export type ClubConfirmAnswer =
  | { readonly kind: 'confirmed'; readonly count: number }
  | {
      readonly kind: 'refused';
      readonly reason: Exclude<ClubConfirmDecision, { ok: true }>['refusal'];
      readonly ineligible: readonly string[];
    };

/**
 * A club's media release pages and commands (ADR 0151): its owner, or a
 * school's staff, confirms releases it already holds for its Youth students,
 * and sees where each stands.
 */
export function createMediaReleaseClubs(input: {
  readonly run: BoundedTransaction;
  readonly nextId: () => string;
}) {
  const { run, nextId } = input;
  return {
    /** The club's students and their releases, for its owner or staff; else null. */
    readClubReleases: (
      viewerUserId: string,
      /** The club's id (its pages' address) or its handle (a notice's link). */
      ref: string,
    ): Promise<ClubReleasesRead | null> =>
      run(async (tx) => {
        const club = await readClub(
          tx,
          idSchema.safeParse(ref).success ? { id: ref } : { handle: ref },
          false,
        );
        if (club === null) return null;
        const role = await clubReleaseRole(tx, club, viewerUserId);
        if (role === null) return null;
        const now = await readDatabaseTime(tx);
        return {
          club: {
            id: club.id,
            name: club.name,
            handle: club.handle,
            kind: club.kind,
          },
          role,
          students: await youthStudents(tx, club, now.getTime()),
        };
      }),

    /**
     * How many of the club's Youth students hold no release on file: the
     * tab's badge, in one query, for its owner or staff; else null.
     */
    countClubReleasesNeeded: (
      viewerUserId: string,
      ref: string,
    ): Promise<number | null> =>
      run(async (tx) => {
        const club = await readClub(
          tx,
          idSchema.safeParse(ref).success ? { id: ref } : { handle: ref },
          false,
        );
        if (club === null) return null;
        if ((await clubReleaseRole(tx, club, viewerUserId)) === null)
          return null;
        await scopeTransaction(tx, { organizationId: club.id });
        const [count] = await queryRows(
          tx,
          z.object({ n: z.number() }),
          sql`select count(*)::int as n from memberships m
            join users u on u.id = m.user_id and u.deleted_at is null
            join account_age on account_age.user_id = m.user_id
            where m.organization_id = ${club.id} and m.status = 'active'
              and ${divisionOfBandSql(divisionAgeBand())} = 'youth'
              and not exists (select 1 from media_releases r
                where r.user_id = m.user_id and r.scope = 'publish'
                  and r.withdrawn_at is null)`,
        );
        return count?.n ?? 0;
      }),

    /** The club confirms releases for every selected student, or none. */
    confirmClubReleases: (command: {
      readonly viewerUserId: string;
      readonly organizationId: string;
      readonly studentUserIds: readonly string[];
      readonly form: unknown;
    }): Promise<ClubConfirmAnswer> => {
      const ids = [...new Set(command.studentUserIds)];
      if (
        !idSchema.safeParse(command.organizationId).success ||
        ids.length > 200 ||
        ids.some((id) => !idSchema.safeParse(id).success)
      )
        throw createAppError('VALIDATION');
      return run(async (tx) => {
        const club = await readClub(tx, { id: command.organizationId }, true);
        if (club === null) throw createAppError('NOT_FOUND');
        if ((await clubReleaseRole(tx, club, command.viewerUserId)) === null)
          throw createAppError('NOT_FOUND');
        // Each student's account row orders every command about them.
        for (const id of [...ids].sort())
          await runStatement(
            tx,
            sql`select 1 from users where id = ${id} for update`,
          );
        const now = await readDatabaseTime(tx);
        const found =
          ids.length === 0
            ? []
            : await youthStudents(tx, club, now.getTime(), ids);
        const decision = decideClubConfirm(
          ids.map((userId) => {
            const student = found.find((s) => s.userId === userId);
            return student === undefined
              ? {
                  userId,
                  member: false,
                  youth: false,
                  standing: { kind: 'none' },
                }
              : {
                  userId,
                  member: true,
                  youth: true,
                  standing: student.standing,
                };
          }),
          command.form,
        );
        if (!decision.ok)
          return {
            kind: 'refused',
            reason: decision.refusal,
            ineligible: decision.ineligible,
          };
        for (const student of decision.confirm) {
          const releaseIds: string[] = [];
          for (const scope of decision.scopes) {
            const releaseId = nextId();
            releaseIds.push(releaseId);
            await insertMediaRelease(tx, {
              id: releaseId,
              userId: student.userId,
              scope,
              parent: null,
              now,
            });
            await scopeTransaction(tx, { organizationId: club.id });
            await runStatement(
              tx,
              sql`insert into media_release_club_attestations (release_id,
                  organization_id, user_id, attested_by_user_id, attester_name,
                  attester_role)
                values (${releaseId}, ${club.id}, ${student.userId},
                  ${command.viewerUserId}, ${decision.name}, ${decision.role})`,
            );
          }
          if (student.supersedes !== null)
            await runStatement(
              tx,
              sql`update media_release_requests set outcome = 'superseded',
                  resolved_at = clock_timestamp()
                where id = ${student.supersedes} and outcome is null`,
            );
          await oweNotifications(tx, {
            kind: 'media_release_club_confirmed',
            subject: { media_release_id: releaseIds[0]! },
            recipients: [{ userId: student.userId, about: null }],
            at: now.toISOString(),
            nextId,
          });
        }
        return { kind: 'confirmed', count: decision.confirm.length };
      });
    },

    /**
     * "Ask my club": a Youth member asks a club they belong to; its owner and
     * staff are told. At most once a week per club.
     */
    askClub: (command: {
      readonly userId: string;
      readonly actorId: string;
      readonly organizationId: string;
    }): Promise<{
      readonly kind: 'asked' | 'already_asked' | 'not_a_member';
    }> => {
      if (!idSchema.safeParse(command.organizationId).success)
        throw createAppError('VALIDATION');
      return run(async (tx) => {
        await runStatement(
          tx,
          sql`select 1 from users where id = ${command.userId} for update`,
        );
        const club = await readClub(tx, { id: command.organizationId }, false);
        if (club === null) return { kind: 'not_a_member' };
        await scopeTransaction(tx, {
          organizationId: club.id,
          subjectUserId: command.userId,
        });
        const [member] = await queryRows(
          tx,
          z.object({ n: z.number() }),
          sql`select count(*)::int as n from memberships
            where organization_id = ${club.id} and user_id = ${command.userId}
              and status = 'active'`,
        );
        if (
          (member?.n ?? 0) === 0 ||
          (await readDivisionOf(tx, command.userId)) !== 'youth'
        )
          return { kind: 'not_a_member' };
        const [recent] = await queryRows(
          tx,
          z.object({ n: z.number() }),
          sql`select count(*)::int as n from media_release_club_asks
            where organization_id = ${club.id} and user_id = ${command.userId}
              and asked_at > clock_timestamp() - interval '7 days'`,
        );
        if ((recent?.n ?? 0) > 0) return { kind: 'already_asked' };
        const now = await readDatabaseTime(tx);
        const askId = nextId();
        await runStatement(
          tx,
          sql`insert into media_release_club_asks (id, organization_id, user_id, asked_at)
            values (${askId}, ${club.id}, ${command.userId}, ${now.toISOString()})`,
        );
        const staff = (await clubReleaseStaff(tx, club)).filter(
          (userId) => userId !== command.userId,
        );
        await oweNotifications(tx, {
          kind: 'media_release_club_asked',
          subject: { media_release_club_ask_id: askId },
          recipients: staff.map((userId) => ({
            userId,
            about: command.actorId,
          })),
          at: now.toISOString(),
          nextId,
        });
        return { kind: 'asked' };
      });
    },
  };
}
