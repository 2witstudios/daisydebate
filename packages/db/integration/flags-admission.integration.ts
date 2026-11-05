import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { sql } from 'drizzle-orm';
import { requireFlagAdmission, type ReleaseAdmission } from '../src/flags';
import { lockFlags } from '../src/flags-lock';
import { lockAuthorizationActors } from '../src/authorization';
import {
  flagCommand,
  withFlags,
  barrier,
  waitingForFlags,
} from './flags.test-support';

setupRitewayBun();
const policy = (key: string): ReleaseAdmission => ({
  keys: [key],
  decide: (snapshot, now) => {
    if (snapshot.kind !== 'available') return false;
    const fact = snapshot.flags[0]!;
    if (fact.state === 'killed') return false;
    return fact.override && fact.override.expiresAt > now
      ? fact.override.enabled
      : fact.state === 'enabled';
  },
});

test('a new durable admission holds a shared Flags lock through commit; later disable closes new admissions', async () => {
  await withFlags(
    async ({ fixture, database, store, key, userId, actorId }) => {
      await store.runFlagCommand(flagCommand(key, 0));
      const admitted = barrier();
      const finish = barrier();
      // The fixture account's name is only a durable transaction witness, not a purchase feature.
      const admission = database.transaction(async (tx) => {
        await lockAuthorizationActors(tx, [actorId], { maxActors: 1 });
        const result = await requireFlagAdmission(tx, userId, policy(key));
        await tx.execute(
          sql`update users set name=${result.admittedAt} where id=${userId}`,
        );
        admitted.release();
        await finish.ready;
        return result;
      });
      await admitted.ready;
      const disable = store.runFlagCommand(
        flagCommand(key, 1, { action: 'flag.state.update', state: 'killed' }),
      );
      try {
        await waitingForFlags(fixture);
      } finally {
        finish.release();
      }
      const { admittedAt } = await admission;
      await disable;
      await assertRejects({
        given: 'a disable completed after an earlier admission committed',
        should: 'refuse the next new intent',
        actual: () =>
          database.transaction(async (tx) => {
            await lockAuthorizationActors(tx, [actorId], { maxActors: 1 });
            return requireFlagAdmission(tx, userId, policy(key));
          }),
        code: 'NOT_FOUND',
      });
      const [witness] =
        await fixture.sql`select name from users where id=${userId}`;
      assert({
        given: 'the accepted transaction',
        should:
          'return the sampled admission instant to persist with its intent',
        actual: {
          instant: Number.isFinite(Date.parse(admittedAt)),
          persisted: witness!.name,
        },
        expected: { instant: true, persisted: admittedAt },
      });
    },
  );
});

test('admission reads a separate post-lock snapshot and clock after a concurrent disable or expiry', async () => {
  await withFlags(
    async ({ fixture, database, store, key, userId, actorId }) => {
      await store.runFlagCommand(flagCommand(key, 0));
      const locked = barrier();
      const finish = barrier();
      const writer = database.transaction(async (tx) => {
        await lockFlags(tx, 'write');
        await tx.execute(
          sql`update release_flags set state='killed', revision=2 where key=${key}`,
        );
        locked.release();
        await finish.ready;
      });
      await locked.ready;
      const admission = database.transaction(async (tx) => {
        await lockAuthorizationActors(tx, [actorId], { maxActors: 1 });
        return requireFlagAdmission(tx, userId, policy(key));
      });
      // Observe the rejection immediately so no unhandled promise can escape on cleanup.
      const settled = Promise.allSettled([admission]);
      try {
        await waitingForFlags(fixture);
      } finally {
        finish.release();
      }
      await writer;
      assert({
        given:
          'a new admission whose lock statement began before the disabling writer committed',
        should: 'see the committed disable in its next statement',
        actual: (await settled)[0]!.status,
        expected: 'rejected',
      });
      await fixture.sql`update release_flags set state='default' where key=${key}`;
      await fixture.sql`insert into flag_account_overrides(key,user_id,enabled,created_at,expires_at)
      values(${key},${userId},true,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '100 milliseconds')`;
      const expiringLock = barrier();
      const expire = barrier();
      const holder = database.transaction(async (tx) => {
        await lockFlags(tx, 'write');
        expiringLock.release();
        await expire.ready;
      });
      await expiringLock.ready;
      const waited = database.transaction(async (tx) => {
        await lockAuthorizationActors(tx, [actorId], { maxActors: 1 });
        return requireFlagAdmission(tx, userId, policy(key));
      });
      const outcome = Promise.allSettled([waited]);
      try {
        await waitingForFlags(fixture);
        await fixture.sql`select pg_sleep(0.15)`;
      } finally {
        expire.release();
      }
      await holder;
      assert({
        given: 'an override expired while admission waited',
        should: 'use the post-lock clock and reject without a sweep',
        actual: (await outcome)[0]!.status,
        expected: 'rejected',
      });
    },
  );
});

test('Flags admission refuses lock upgrades, stale transaction snapshots and unbounded key closures', async () => {
  await withFlags(async ({ database, key, userId }) => {
    await assertRejects({
      given: 'an admission transaction that tries to become a writer',
      should: 'refuse a shared-to-exclusive lock upgrade',
      actual: () =>
        database.transaction(async (tx) => {
          await lockFlags(tx, 'read');
          await lockFlags(tx, 'write');
        }),
      code: 'INVARIANT',
    });
    await assertRejects({
      given: 'a repeatable-read transaction',
      should: 'refuse a stale fixed snapshot',
      actual: () =>
        database.transaction(async (tx) => {
          await tx.execute(
            sql`set transaction isolation level repeatable read`,
          );
          await requireFlagAdmission(tx, userId, policy(key));
        }),
      code: 'INVARIANT',
    });
    await assertRejects({
      given: 'an oversized closure from a caller',
      should: 'refuse before reading arbitrary flags',
      actual: () =>
        database.transaction((tx) =>
          requireFlagAdmission(tx, userId, {
            keys: Array.from({ length: 33 }, (_, i) => `test-${i}`),
            decide: () => true,
          }),
        ),
      code: 'VALIDATION',
    });
    const settings = await database.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout='50ms'`);
      await tx.execute(sql`set local statement_timeout='200ms'`);
      await lockFlags(tx, 'read');
      const [row] =
        await tx.execute(sql`select current_setting('lock_timeout') as lock,
        current_setting('statement_timeout') as statement,
        current_setting('transaction_timeout') as transaction`);
      return row;
    });
    assert({
      given: 'a bounded caller',
      should:
        'keep stricter wait/statement bounds and bound transaction lifetime',
      actual: settings,
      expected: { lock: '50ms', statement: '200ms', transaction: '5s' },
    });
  });
});

test('admission lock timeout and transaction deadline roll back the caller witness', async () => {
  await withFlags(async ({ fixture, database, store, key, userId }) => {
    await store.runFlagCommand(flagCommand(key, 0));
    const held = barrier();
    const finish = barrier();
    const holder = database.transaction(async (tx) => {
      await lockFlags(tx, 'write');
      held.release();
      await finish.ready;
    });
    await held.ready;
    let waitStatus: string;
    try {
      const waiting = await Promise.allSettled([
        database.transaction(async (tx) => {
          await tx.execute(sql`set local lock_timeout='30ms'`);
          await tx.execute(
            sql`update users set name='must roll back' where id=${userId}`,
          );
          await requireFlagAdmission(tx, userId, policy(key));
        }),
      ]);
      waitStatus = waiting[0]!.status;
    } finally {
      finish.release();
    }
    await holder;
    const timed = await Promise.allSettled([
      database.transaction(async (tx) => {
        await tx.execute(sql`set local transaction_timeout='100ms'`);
        await tx.execute(
          sql`update users set name='must also roll back' where id=${userId}`,
        );
        await requireFlagAdmission(tx, userId, policy(key));
        await tx.execute(sql`select pg_sleep(0.2)`);
      }),
    ]);
    const [witness] =
      await fixture.sql`select name from users where id=${userId}`;
    assert({
      given:
        'a Flags lock wait past the caller bound and a stalled admitted transaction',
      should: 'abort both and persist neither tentative write',
      actual: {
        waitStatus,
        transactionStatus: timed[0]!.status,
        name: witness!.name,
      },
      expected: {
        waitStatus: 'rejected',
        transactionStatus: 'rejected',
        name: '',
      },
    });
  });
});
