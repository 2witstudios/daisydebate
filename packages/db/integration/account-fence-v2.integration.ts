import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SQL } from 'bun';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { withFixture } from './constraint-helpers';
import { createAuthorizationSubject } from './authorization.test-support';
import {
  ageColumns,
  legacyReadShapes,
  v1AccountColumns,
} from './account-fence.test-support';

setupRitewayBun();

const { databaseUrl: url } = requireTestServices(process.env);

/** A migration folder's statements, as the migrator runs them. */
const folderStatements = (suffix: string) => {
  const root = join(import.meta.dir, '..', 'migrations');
  const folder = readdirSync(root).find((name) => name.endsWith(suffix));
  return readFileSync(join(root, folder!, 'migration.sql'), 'utf8')
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter(
      (statement) =>
        statement.length > 0 && !/^(--[^\n]*\n?)+$/.test(statement),
    );
};

/** Every statement the gate and its follow-up re-install in place. */
const reinstalledStatements = () =>
  ['_beta_access_gate', '_age_band_null_birth_month']
    .flatMap(folderStatements)
    .map((statement) => statement.replace(/^(--[^\n]*\n)+/, ''))
    .filter((statement) => statement.startsWith('CREATE OR REPLACE FUNCTION'));

describe('the v2 account fence expands without breaking v1 callers (ADR 0075)', () => {
  test('statements prepared against the v1 readers keep working after every in-place re-install', async () => {
    await withFixture(url, async (fixture) => {
      const { userId, actorId } = await createAuthorizationSubject(fixture);
      // A live instance's runtime connection, its old statements prepared.
      const live = new SQL(url, { max: 1 });
      const installer = new SQL(url, { max: 1 });
      try {
        await live.unsafe('set role daisy_web');
        const subject = { userId, actorId };
        const read = () => legacyReadShapes(live, subject);
        const before = await read();
        // The release migrator re-installs on its own connection.
        await installer.begin(async (tx) => {
          for (const statement of reinstalledStatements())
            await tx.unsafe(statement);
        });
        const v1 = v1AccountColumns;
        const age = ageColumns;
        assert({
          given:
            'the v1 account, v1 Room and age reads prepared on a live runtime connection, then every in-place re-install applied',
          should:
            'keep each exact result shape on the same connection (ISSUE-677 holds the predecessor-database proof)',
          actual: {
            before,
            after: await read(),
            reinstalled: reinstalledStatements().length,
          },
          expected: {
            before: [v1, v1, age],
            after: [v1, v1, age],
            reinstalled: 3,
          },
        });
      } finally {
        await live.close();
        await installer.close();
      }
    });
  });

  test('under each runtime role, v2 returns exactly the minimal projection and no birth data', async () => {
    await withFixture(url, async (fixture) => {
      const { userId, actorId } = await createAuthorizationSubject(fixture);
      const columns: unknown[] = [];
      for (const role of ['daisy_web', 'daisy_realtime']) {
        await fixture.sql.begin(async (tx) => {
          await tx.unsafe(`set local role ${role}`);
          const [account] =
            await tx`select * from public.daisy_authorization_accounts_v2(null::text[], ${userId}::text, false)`;
          const [room] =
            await tx`select * from public.daisy_room_read_account_v2(${actorId}::text, ${userId}::text)`;
          columns.push(Object.keys(account ?? {}), Object.keys(room ?? {}));
        });
      }
      const minimal = [
        'userId',
        'actorId',
        'member',
        'erased',
        'revision',
        'betaState',
        'betaRevision',
        'ageBand',
      ];
      assert({
        given:
          'the v2 account and Room reader functions under daisy_web and daisy_realtime',
        should:
          'return exactly the minimal account columns, never birth_month or timestamps',
        actual: columns,
        expected: [minimal, minimal, minimal, minimal],
      });
    });
  });
});

describe('one age validity rule for the fence and the age reader (ADR 0075)', () => {
  test('both producers agree, and only a valid record yields a band', async () => {
    await withFixture(url, async (fixture) => {
      const cases = [
        ['valid adult', "'2000-01', 1, now() - interval '1 day'"],
        ['future recorded time', "'2000-01', 1, now() + interval '1 day'"],
        ['infinite recorded time', "'2000-01', 1, 'infinity'::timestamptz"],
        [
          'future birth month',
          "to_char(now() + interval '2 months', 'YYYY-MM'), 1, now() - interval '1 day'",
        ],
      ] as const;
      const actual: unknown[] = [];
      for (const [, source] of cases) {
        const { userId, actorId } = await createAuthorizationSubject(fixture);
        await fixture.sql.unsafe(
          `update account_age set (birth_month, version, recorded_at) = (select ${source}) where user_id = $1`,
          [userId],
        );
        const [fence] =
          await fixture.sql`select "ageBand" from public.daisy_authorization_accounts_v2(null::text[], ${userId}::text, false)`;
        const reader =
          await fixture.sql`select band from public.daisy_authorization_age(${userId}, ${actorId}, (select version from users where id = ${userId}), clock_timestamp())`;
        actual.push([fence?.ageBand ?? null, reader[0]?.band ?? null]);
      }
      const missing = await createAuthorizationSubject(fixture);
      await fixture.sql`delete from account_age where user_id = ${missing.userId}`;
      const [none] =
        await fixture.sql`select "ageBand" from public.daisy_authorization_accounts_v2(null::text[], ${missing.userId}::text, false)`;
      const erased = await createAuthorizationSubject(fixture);
      await fixture.sql`update users set username = null, email = null, image = null, name = '', deleted_at = now(), version = version + 1 where id = ${erased.userId}`;
      const [tombstone] =
        await fixture.sql`select "ageBand" from public.daisy_authorization_accounts_v2(null::text[], ${erased.userId}::text, false)`;
      assert({
        given:
          'a valid adult record, a future or infinite recorded time, a future birth month, no record and an erased account',
        should:
          'classify only the valid record, identically in the fence and the age reader',
        actual: [...actual, none?.ageBand ?? null, tombstone?.ageBand ?? null],
        expected: [
          ['adult', 'adult'],
          [null, null],
          [null, null],
          [null, null],
          null,
          null,
        ],
      });
    });
  });

  test('a corrected record is classified fresh under the account fence', async () => {
    await withFixture(url, async (fixture) => {
      const { userId, actorId } = await createAuthorizationSubject(fixture);
      const band = async () =>
        (
          await fixture.sql.begin(async (tx) => {
            await tx`select * from public.daisy_authorization_accounts_v2(array[${actorId}]::text[], null::text, true)`;
            return tx`select "ageBand" from public.daisy_authorization_accounts_v2(null::text[], ${userId}::text, false)`;
          })
        )[0]?.ageBand ?? null;
      const before = await band();
      await fixture.sql`update account_age set birth_month = to_char(now() - interval '17 years 1 month', 'YYYY-MM'), version = version + 1 where user_id = ${userId}`;
      assert({
        given: 'an adult record corrected to a 17-year-old birth month',
        should: 'report the corrected band on the next fenced read',
        actual: [before, await band()],
        expected: ['adult', '16-17'],
      });
    });
  });

  test('the shared helper is total: a null birth month is no record', async () => {
    await withFixture(url, async (fixture) => {
      const [row] = await fixture.sql`select
        public.daisy_age_band(null, 1, now() - interval '1 day', now()) as missing,
        public.daisy_age_band('2000-01', 1, now() - interval '1 day', now()) as adult`;
      assert({
        given:
          'a null birth month beside an otherwise valid record (ISSUE-676)',
        should: 'return NULL, never fall through to adult',
        actual: [row?.missing ?? null, row?.adult ?? null],
        expected: [null, 'adult'],
      });
    });
  });
});
