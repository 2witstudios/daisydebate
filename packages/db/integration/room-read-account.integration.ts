import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { lockAuthorizationActors } from '../src/authorization';
import { sharedAccount } from '../src/room-command-facts';
import { withFixture, sqlStateOf } from './constraint-helpers';
import { createAuthorizationSubject } from './authorization.test-support';
setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);
for (const role of ['daisy_web', 'daisy_realtime'])
  test(`Room shared account fence preserves minimal ${role} authority and excludes writers`, async () => {
    await withFixture(url, async (fixture) => {
      const caller = await createAuthorizationSubject(fixture);
      await fixture.sql.begin(async (client) => {
        await client.unsafe(`set local role ${role}`);
        await client`create temporary table users(id text) on commit drop`;
        const db = drizzle({ client });
        const account = await sharedAccount(db, caller);
        const peer = await fixture.sql.begin(
          (other) =>
            other`select * from public.daisy_room_read_account(${caller.actorId},${caller.userId})`,
        );
        const writers = await Promise.all(
          ['update', 'no key update'].map((mode) =>
            sqlStateOf(() =>
              fixture.sql.begin((other) =>
                other.unsafe(
                  `select id from public.users where id=$1 for ${mode} nowait`,
                  [caller.userId],
                ),
              ),
            ),
          ),
        );
        assert({
          given:
            'peer shared readers under a minimal role and a shadowing temp table',
          should:
            'return current minimal authority while excluding both exclusive and non-key account writers',
          actual: { account, peer: peer[0], writers },
          expected: {
            account: {
              ...caller,
              member: true,
              erased: false,
              revision: 1,
              beta: { state: 'approved', revision: 1 },
              ageBand: 'adult',
            },
            // The v1 reader keeps its exact five-column contract (ADR 0075).
            peer: { ...caller, member: true, erased: false, revision: 1 },
            writers: ['55P03', '55P03'],
          },
        });
      });
      const invalid = await Promise.all(
        [
          () =>
            fixture.sql`select * from public.daisy_room_read_account(null,${caller.userId})`,
          () =>
            fixture.sql`select * from public.daisy_room_read_account('invalid',${caller.userId})`,
          () =>
            fixture.sql`select * from public.daisy_room_read_account(${caller.actorId},null)`,
        ].map(sqlStateOf),
      );
      const mismatch =
        await fixture.sql`select * from public.daisy_room_read_account(${caller.actorId},${createId()})`;
      const [security] =
        await fixture.sql`select prosecdef,proconfig,not exists(select 1 from aclexplode(proacl) acl where acl.grantee=0 and acl.privilege_type='EXECUTE') public_refused from pg_proc where oid='public.daisy_room_read_account(text,text)'::regprocedure`;
      assert({
        given:
          'malformed/mismatched selectors and the deployed SQL security contract',
        should:
          'fail closed without public execute authority or an attacker-controlled search path',
        actual: { invalid, mismatch: [...mismatch], security },
        expected: {
          invalid: ['22023', '22023', '22023'],
          mismatch: [],
          security: {
            prosecdef: true,
            proconfig: ['search_path=pg_catalog, pg_temp'],
            public_refused: true,
          },
        },
      });
    });
  });
test('Room reader reloads tombstone after waiting for the exclusive writer', async () => {
  await withFixture(url, async (fixture) => {
    const caller = await createAuthorizationSubject(fixture);
    const { promise: entered, resolve: enter } = Promise.withResolvers<void>();
    const { promise: released, resolve: release } =
      Promise.withResolvers<void>();
    const writer = fixture.sql.begin(async (tx) => {
      await tx`update users set username=null,email_verified=false,deleted_at=statement_timestamp(),version=version+1 where id=${caller.userId}`;
      enter();
      await released;
    });
    await entered;
    const reader = drizzle({ client: fixture.sql }).transaction((tx) =>
      sharedAccount(tx, caller),
    );
    try {
      let waiting = false;
      for (let attempt = 0; attempt < 1000; attempt++) {
        const [row] =
          await fixture.sql`select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%daisy_room_read_account%') waiting`;
        if (row.waiting) {
          waiting = true;
          break;
        }
      }
      if (!waiting)
        throw new Error(
          'Shared reader did not reach observed exclusive writer barrier',
        );
      release();
      await writer;
      assert({
        given: 'an erasure writer already holding the user fence',
        should:
          'wait without upgrading locks and load the committed tombstone rather than pre-wait membership',
        actual: await reader,
        expected: {
          ...caller,
          member: false,
          erased: true,
          revision: 2,
          beta: { state: 'approved', revision: 1 },
          ageBand: null,
        },
      });
    } finally {
      release();
      await writer;
      await reader;
    }
  });
});

test('mixed shared readers and reversed multi-account writers retain canonical lock order', async () => {
  await withFixture(url, async (fixture) => {
    const callers = [
      await createAuthorizationSubject(fixture),
      await createAuthorizationSubject(fixture),
    ].sort((a, b) => a.userId.localeCompare(b.userId));
    const [low, high] = callers;
    const { promise: entered, resolve: enter } = Promise.withResolvers<void>();
    const { promise: released, resolve: release } =
      Promise.withResolvers<void>();
    const holder = drizzle({ client: fixture.sql }).transaction(async (tx) => {
      await sharedAccount(tx, low!);
      enter();
      await released;
    });
    await entered;
    const writer = drizzle({ client: fixture.sql }).transaction((tx) =>
      lockAuthorizationActors(tx, [high!.actorId, low!.actorId], {
        maxActors: 2,
      }),
    );
    try {
      let waiting = false;
      for (let attempt = 0; attempt < 1000; attempt++) {
        const [row] =
          await fixture.sql`select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%daisy_authorization_accounts%') waiting`;
        if (row.waiting) {
          waiting = true;
          break;
        }
      }
      if (!waiting)
        throw new Error(
          'Writer did not reach observed lower-user shared fence',
        );
      const peer = await fixture.sql.begin(async (client) => {
        await client`set local lock_timeout=2000`;
        return client`select * from public.daisy_room_read_account(${high!.actorId},${high!.userId})`;
      });
      assert({
        given:
          'a reversed multi-account writer queued behind the lower-user reader',
        should:
          'lock in canonical user order and leave the higher-user reader free without any lock upgrade',
        actual: peer[0]?.member,
        expected: true,
      });
    } finally {
      release();
      await holder;
      await writer;
    }
    const [row] =
      await fixture.sql`select count(*)::int waiting from pg_stat_activity where datname=current_database() and wait_event_type='Lock'`;
    assert({
      given: 'mixed readers/writer completed',
      should: 'release every lock waiter',
      actual: row.waiting,
      expected: 0,
    });
  });
});
