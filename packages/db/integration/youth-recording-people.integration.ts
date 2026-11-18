import type { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, test } from 'riteway/bun';
import { readLinkedAdultUserIds } from '../src/youth-recording-people';
import { integrationSuite } from './suite.test-support';
import { inRolledBackTransaction } from './tab.test-support';

const { databaseUrl: url } = integrationSuite();

/** A person with an age record `age` back from now. */
const person = async (sql: SQL, age: string) => {
  const id = createId();
  await sql`insert into users(id, username) values(${id}, ${`u-${id}`})`;
  await sql`insert into account_age(user_id, birth_month, version, recorded_at)
    values(${id}, to_char(now() - ${age}::interval, 'YYYY-MM'), 1, now() - interval '1 second')`;
  return id;
};

const school = async (sql: SQL, ownerUserId: string) => {
  const id = createId();
  await sql`insert into organizations(id, kind, name, handle, owner_user_id)
    values(${id}, 'school', 'Riverside High', ${`riverside-${id.slice(0, 8)}`}, ${ownerUserId})`;
  return id;
};

const member = (sql: SQL, organizationId: string, userId: string) =>
  sql`insert into memberships(organization_id, user_id, status, joined_at)
    values(${organizationId}, ${userId}, 'active', now())`;

const rosterGrant = async (
  sql: SQL,
  organizationId: string,
  userId: string,
) => {
  const [role] = await sql`select r.id from roles r
    join role_permissions p on p.role_id = r.id
    where r.preset and p.permission = 'school.roster.manage' limit 1`;
  await sql`insert into grants(id, role_id, user_id, scope_kind, organization_id, granted_at)
    values(${createId()}, ${role!.id}, ${userId}, 'organization', ${organizationId}, now())`;
};

/**
 * PYL-5: who is linked to a youth debater, read as the web's runtime role, so
 * every row comes through row-level security under the scope it belongs to.
 */
test('a youth debater’s linked adults are read through the tenant fence', async () => {
  await inRolledBackTransaction(url, async (sql) => {
    const student = await person(sql, '16 years');
    const owner = await person(sql, '50 years');
    const coach = await person(sql, '40 years');
    const minorStaff = await person(sql, '17 years');
    const otherCoach = await person(sql, '40 years');
    const parent = await person(sql, '45 years');
    const formerParent = await person(sql, '45 years');
    const riverside = await school(sql, owner);
    const elsewhere = await school(sql, otherCoach);
    for (const userId of [student, coach, minorStaff])
      await member(sql, riverside, userId);
    await member(sql, elsewhere, otherCoach);
    await rosterGrant(sql, riverside, coach);
    await rosterGrant(sql, riverside, minorStaff);
    await sql`insert into guardian_links(id, guardian_user_id, minor_user_id, kind, status)
      values(${createId()}, ${parent}, ${student}, 'parent', 'active')`;
    await sql`insert into guardian_links(id, guardian_user_id, minor_user_id, kind, status, ended_at)
      values(${createId()}, ${formerParent}, ${student}, 'parent', 'ended', now())`;

    await sql.unsafe('set local role daisy_web');
    const linked = await readLinkedAdultUserIds(
      drizzle({ client: sql }),
      student,
    );
    const [scope] =
      await sql`select current_setting('daisy.organization_scope', true) as organization,
      current_setting('daisy.subject_scope', true) as subject`;
    await sql.unsafe('reset role');

    assert({
      given:
        'a student’s school owner, an adult coach and a minor with roster grants, another school’s coach, a parent and a former parent',
      should:
        'name the owner, the adult coach and the parent only, and leave no scope behind',
      actual: {
        linked: [...linked].sort(),
        scope: { organization: scope!.organization, subject: scope!.subject },
      },
      expected: {
        linked: [owner, coach, parent].sort(),
        scope: { organization: '', subject: '' },
      },
    });
  });
});
