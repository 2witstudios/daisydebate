import { daisyOrganizationId } from '@daisy/db/testing';
import { createId } from '@paralleldrive/cuid2';
import type { withRoomRuntime } from './room-runtime.test-support';

/**
 * Youth Round fixtures (PYL-5, ADR 0155): ages, Daisy's seasons, a school
 * with a coach, and the cleanup of the links a test made.
 */
export type Fixture = Parameters<Parameters<typeof withRoomRuntime>[0]>[0];
export type Member = Fixture['host'];

export const setAge = (f: Fixture, member: Member, age: string) =>
  f.sql`update account_age
    set birth_month = to_char(now() - ${age}::interval, 'YYYY-MM'), version = version + 1,
      recorded_at = now() - interval '1 second'
    where user_id = ${member.userId}`;

/** Daisy's active seasons, one per division: a Youth Room needs its own to start ranked. */
export const withYouthSeason = async (f: Fixture, run: () => Promise<void>) => {
  const ids: string[] = [];
  try {
    for (const division of ['open', 'youth'] as const) {
      const id = createId();
      await f.sql`insert into seasons(organization_id,id,division,name,starts_at,status)
        values(${daisyOrganizationId},${id},${division},'Youth recording fixture',now() - interval '1 day','active')`;
      ids.push(id);
    }
    await run();
  } finally {
    for (const id of ids) {
      await f.sql`delete from agreement_signatures where season_id=${id}`;
      await f.sql`delete from seasons where id=${id}`;
    }
  }
};

/** A school the youth debater belongs to, with a coach holding a roster grant. */
export const schoolWithCoach = async (
  f: Fixture,
  made: { readonly schools: string[] },
  input: {
    readonly owner: Member;
    readonly coach: Member;
    readonly student: Member;
  },
) => {
  const id = createId();
  made.schools.push(id);
  const [role] = await f.sql`select r.id from roles r
    join role_permissions p on p.role_id = r.id
    where r.preset and p.permission = 'school.roster.manage' limit 1`;
  await f.sql`insert into organizations(id,kind,name,handle,owner_user_id)
    values(${id},'school','Riverside High',${`riverside-${id.slice(0, 8)}`},${input.owner.userId})`;
  for (const member of [input.coach, input.student])
    await f.sql`insert into memberships(organization_id,user_id,status,joined_at)
      values(${id},${member.userId},'active',now())`;
  const grantId = createId();
  await f.sql`insert into grants(id,role_id,user_id,scope_kind,organization_id,granted_at)
    values(${grantId},${role!.id},${input.coach.userId},'organization',${id},now())`;
  return { id, grantId };
};

/** Removes the links and schools a test made, so the fixture can drop its people. */
export const withLinks = async (
  f: Fixture,
  run: (made: {
    readonly schools: string[];
    readonly users: string[];
    readonly rounds: string[];
  }) => Promise<void>,
) => {
  const made = {
    schools: [] as string[],
    users: [] as string[],
    rounds: [] as string[],
  };
  try {
    await run(made);
  } finally {
    // Grants and links are append-only by trigger; a test's own rows go in one
    // transaction that bypasses only user triggers, children first.
    await f.sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      for (const roundId of made.rounds)
        await tx`delete from recordings where round_id=${roundId}`;
      for (const userId of made.users)
        await tx`delete from guardian_links where guardian_user_id=${userId} or minor_user_id=${userId}`;
      for (const id of made.schools) {
        await tx`delete from grants where organization_id=${id}`;
        await tx`delete from membership_periods where organization_id=${id}`;
        await tx`delete from memberships where organization_id=${id}`;
        await tx`delete from organizations where id=${id}`;
      }
    });
  }
};
