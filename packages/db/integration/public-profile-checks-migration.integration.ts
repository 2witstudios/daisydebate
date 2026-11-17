import { afterAll } from 'bun:test';
import { SQL } from 'bun';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { rejectedBy, withFixture } from './constraint-helpers';
import {
  ddlTimeoutMs,
  scratchDatabase,
} from './scratch-migrations.test-support';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

const added = '20261116214903_faulty_ma_gnuci';
const validated = '20261116220011_public_profile_checks_validated';
const scratch = scratchDatabase(url, 'profilechecks');

afterAll(() => scratch.drop());

/** Whether PostgreSQL has validated users_image_unused against stored rows. */
const imageCheckValidated = async (sql: SQL) => {
  const [row] = (await sql`select convalidated from pg_constraint
    where conname = 'users_image_unused'`) as { convalidated: boolean }[];
  return row?.convalidated ?? null;
};

test('a database with no stored image ends with users_image_unused validated', async () => {
  const sql = new SQL(url, { max: 1 });
  try {
    assert({
      given: 'the committed migrations applied to the test database',
      should: 'leave the constraint validated',
      actual: await imageCheckValidated(sql),
      expected: true,
    });
  } finally {
    await sql.close();
  }
});

test(
  'a stored image neither refuses the migration nor escapes it afterwards (ADR 0143)',
  async () => {
    await scratch.create();
    await scratch.migrate((folder) => folder < added);
    await withFixture(scratch.url, async (f) => {
      const userId = await f.user();
      // What the schema before allowed: Better Auth's image column, set.
      await f.sql`update users set image = 'https://example.test/a.png' where id = ${userId}`;
      await scratch.migrate((folder) => folder <= validated);
      const afterMigration = await imageCheckValidated(f.sql);
      const otherUser = await f.user();
      const writes = [
        await rejectedBy(
          () => f.sql`update users set image = 'x' where id = ${otherUser}`,
        ),
        // Any write to the stored row must repair it.
        await rejectedBy(
          () => f.sql`update users set name = 'Ada' where id = ${userId}`,
        ),
        await rejectedBy(
          () => f.sql`update users set image = null where id = ${userId}`,
        ),
      ];
      assert({
        given: 'a user row holding an image stored before the migration',
        should:
          'apply both folders, leave the constraint NOT VALID, refuse a new image and any write that keeps the old one, and accept the repair',
        actual: { afterMigration, writes },
        expected: {
          afterMigration: false,
          writes: ['users_image_unused', 'users_image_unused', null],
        },
      });
    });
  },
  ddlTimeoutMs,
);
