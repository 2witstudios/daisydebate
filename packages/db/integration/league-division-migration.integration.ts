import { afterAll } from 'bun:test';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { daisyOrganizationId } from '../src/daisy-reference';
import { withFixture } from './constraint-helpers';
import { scratchDatabase } from './scratch-migrations.test-support';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

const migration = '20261118140850_league_division';
const validated = '20261118140851_league_division_validated';
const scratch = scratchDatabase(url, 'leaguediv');

afterAll(() => scratch.drop());

test('every stored league becomes Open, Daisy and schools carry no division, and the CHECK validates (PYL-16)', async () => {
  await scratch.create();
  await scratch.migrate((folder) => folder < migration);
  await withFixture(scratch.url, async (f) => {
    const owner = await f.user();
    const league = createId();
    const school = createId();
    for (const [id, kind] of [
      [league, 'league'],
      [school, 'school'],
    ] as const)
      await f.insert('organizations', {
        id,
        kind,
        name: `${kind} ${id}`,
        handle: `${kind}-${id}`,
        owner_user_id: owner,
      });
    await scratch.migrate((folder) => folder <= validated);
    const rows = (await f.sql`
      select id, league_division from organizations
       where id in ${f.sql([league, school, daisyOrganizationId])}`) as Array<{
      id: string;
      league_division: string | null;
    }>;
    const division = (id: string) =>
      rows.find((row) => row.id === id)?.league_division;
    const [check] = await f.sql`
      select convalidated from pg_constraint
       where conname = 'organizations_league_division_check'`;
    const refused = await f
      .insert('organizations', {
        id: createId(),
        kind: 'league',
        name: 'No division',
        handle: `nodiv-${createId()}`,
        owner_user_id: owner,
      })
      .then(
        () => false,
        () => true,
      );
    assert({
      given: 'a stored league and school, and Daisy, before the migration',
      should:
        'make the league Open, leave the school and Daisy without one, validate the CHECK, and refuse a new league without a division',
      actual: {
        league: division(league),
        school: division(school),
        daisy: rows.some((row) => row.id === daisyOrganizationId)
          ? division(daisyOrganizationId)
          : 'absent',
        validated: check?.convalidated,
        refused,
      },
      expected: {
        league: 'open',
        school: null,
        daisy: null,
        validated: true,
        refused: true,
      },
    });
  });
});
