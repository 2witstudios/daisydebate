import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { withFixture } from './constraint-helpers';
import { createAuthorizationSubject } from './authorization.test-support';

setupRitewayBun();

const { databaseUrl: url } = requireTestServices(process.env);

describe('the account fence after its contract step (ADR 0075, BETA-2C)', () => {
  test('only v2 remains, and the age reader runs on it', async () => {
    await withFixture(url, async (fixture) => {
      const { userId, actorId } = await createAuthorizationSubject(fixture);
      const [installed] = await fixture.sql`select
        to_regprocedure('public.daisy_authorization_accounts(text[],text,boolean)') is null as v1_accounts_gone,
        to_regprocedure('public.daisy_room_read_account(text,text)') is null as v1_room_gone,
        to_regprocedure('public.daisy_authorization_accounts_v2(text[],text,boolean)') is not null as v2_accounts,
        to_regprocedure('public.daisy_room_read_account_v2(text,text)') is not null as v2_room`;
      const [age] =
        await fixture.sql`select band from public.daisy_authorization_age(${userId}, ${actorId}, (select version from users where id = ${userId}), clock_timestamp())`;
      assert({
        given: 'the migrated database after the contract step',
        should:
          'hold only the v2 fence functions, with the age reader reading through v2',
        actual: { ...installed, band: age?.band ?? null },
        expected: {
          v1_accounts_gone: true,
          v1_room_gone: true,
          v2_accounts: true,
          v2_room: true,
          band: 'adult',
        },
      });
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
