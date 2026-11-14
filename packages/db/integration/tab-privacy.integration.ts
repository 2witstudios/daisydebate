import type { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, test } from 'riteway/bun';
import { guardianLinksPrivacyAdopter } from '../src/guardian-links-privacy';
import { organizationAuthorityPrivacyAdopter } from '../src/organization-authority-privacy';
import type { PrivacyAdopter } from '../src/privacy/contracts';
import { tournamentRecordPrivacyAdopter } from '../src/tournament-record-privacy';
import { integrationSuite } from './suite.test-support';
import { sampleInstant as at, withSample } from './tab.test-support';

const { databaseUrl: url } = integrationSuite();

/** Runs one adopter step as the runtime role, as the privacy operation does. */
const asRuntime = async <T>(sql: SQL, step: (tx: never) => Promise<T>) => {
  await sql.unsafe('set local role daisy_web');
  const result = await step(drizzle({ client: sql }) as never);
  await sql.unsafe('reset role');
  return result;
};

const run = (
  sql: SQL,
  adopter: PrivacyAdopter,
  subject: { userId: string; actorId: string },
) => ({
  erase: () =>
    asRuntime(sql, (tx) => adopter.erase(tx, subject, { now: at(500) })),
  export: () => asRuntime(sql, (tx) => adopter.export(tx, subject)),
});

/** TAB-4.15 */
test('closing an account ends its authority everywhere and keeps the tournament record', async () => {
  await withSample(url, async (sql, ids) => {
    const [debater] = (await sql.unsafe(
      'select user_id from actors where id = $1',
      [ids.debaters[0]],
    )) as Array<{ user_id: string }>;
    const staff = { userId: ids.staff, actorId: ids.debaters[5]! };
    const member = { userId: debater!.user_id, actorId: ids.debaters[0]! };
    const authority = run(sql, organizationAuthorityPrivacyAdopter, staff);
    const record = run(sql, tournamentRecordPrivacyAdopter, member);
    const exported = await authority.export();
    await authority.erase();
    await authority.erase();
    await record.erase();
    await run(sql, guardianLinksPrivacyAdopter, member).erase();
    const scopeAfter = (
      await sql.unsafe(
        'select daisy_organization_scope() as organization, daisy_lobby_scope() as lobby, daisy_subject_scope() as subject',
      )
    )[0];
    assert({
      given:
        'a staff member with a league membership and a lobby grant, and a debater in an entry, whose accounts close',
      should:
        "export the staff member's own authority, end the membership and revoke the grant once, leave no scope set, and keep the entry and everyone else's rows",
      actual: {
        exported: {
          memberships: exported.memberships?.map((row) => row.status),
          grants: exported.grants?.map((row) => [
            row.scope_kind,
            row.revoked_at,
          ]),
        },
        membership: (
          await sql.unsafe(
            'select status, ended_at is not null as ended, version from memberships where user_id = $1',
            [ids.staff],
          )
        )[0],
        grant: (
          await sql.unsafe(
            'select revoked_at is not null as revoked, revoked_by_user_id = user_id as by_subject from grants where id = $1',
            [ids.staffGrant],
          )
        )[0],
        ownerUntouched: (
          await sql.unsafe(
            'select status from memberships where user_id = $1',
            [ids.owner],
          )
        )[0],
        scopeAfter,
        recordKept: (
          await sql.unsafe(
            `select (select count(*)::int from entry_members where actor_id = $1) as entries,
               (select count(*)::int from result_speakers where actor_id = $1) as results`,
            [ids.debaters[0]],
          )
        )[0],
        recordExport: (await record.export()).entry_members?.map(
          (row) => row.entry_id,
        ),
        guardianExport: await run(
          sql,
          guardianLinksPrivacyAdopter,
          member,
        ).export(),
      },
      expected: {
        exported: { memberships: ['active'], grants: [['lobby', null]] },
        membership: { status: 'ended', ended: true, version: 2 },
        grant: { revoked: true, by_subject: true },
        ownerUntouched: { status: 'active' },
        scopeAfter: { organization: null, lobby: null, subject: null },
        recordKept: { entries: 1, results: 1 },
        recordExport: [ids.teams[0]],
        guardianExport: {
          guardian_links: [],
          restrictions: [],
          restriction_lobbies: [],
        },
      },
    });
  });
});
