import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { createAppError } from '@daisy/errors';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { sql } from 'drizzle-orm';
import type { BoundedTransactionContext } from '../src/transaction-context';
import { createBoundedTransaction } from '../src/bounded-transaction';
import { withPool, withBoundedRound } from './bounded-transaction.test-support';
setupRitewayBun();
requireTestServices(process.env);
test('review: a successfully completed transaction must fence its escaped handle', async () => {
  await withBoundedRound(async (f, run, round) => {
    let escaped: BoundedTransactionContext | undefined;

    await run(async (tx) => {
      escaped = tx;
      await tx.execute(sql`select 1`);
      return 1;
    });
    let refused = false;
    try {
      await escaped!.execute(
        sql`update rounds set resolution=${'escaped-success'} where id=${round}`,
      );
    } catch {
      refused = true;
    }
    const [row] = await f.sql`select resolution from rounds where id=${round}`;
    assert({
      given: 'a callback retains its tx beyond successful commit/release',
      should: 'refuse all later SQL without autocommit mutation',
      actual: { refused, changed: row.resolution === 'escaped-success' },
      expected: { refused: true, changed: false },
    });
  });
});
test('review: caught PostgreSQL error cannot turn ROLLBACK command completion into accepted commit', async () => {
  await withBoundedRound(async (f, run, round) => {
    let response = 'refused';
    try {
      response = await run(async (tx) => {
        await tx.execute(
          sql`update rounds set resolution=${'before-abort'} where id=${round}`,
        );
        try {
          await tx.execute(sql`select 1/0`);
        } catch {
          /* Fault injection: callback deliberately swallows the SQL/control refusal. */
        }
        return 'accepted';
      });
    } catch {
      response = 'refused';
    }
    const [row] = await f.sql`select resolution from rounds where id=${round}`;
    assert({
      given: 'callback catches a real SQL error leaving transaction aborted',
      should:
        'refuse instead of report accepted after PostgreSQL rolls back COMMIT',
      actual: { response, changed: row.resolution === 'before-abort' },
      expected: { response: 'refused', changed: false },
    });
  });
});
test('review: nested transaction on the supplied database handle must not commit before outer refusal', async () => {
  await withBoundedRound(async (f, run, round) => {
    let refused = false;
    try {
      await run(async (tx) => {
        await Reflect.get(
          tx,
          'transaction',
        )(async (nested: BoundedTransactionContext) => {
          await nested.execute(
            sql`update rounds set resolution=${'early-nested-commit'} where id=${round}`,
          );
        });
        throw createAppError('CONFLICT');
      });
    } catch {
      refused = true;
    }
    const [row] = await f.sql`select resolution from rounds where id=${round}`;
    assert({
      given: 'callback uses supplied database transaction API then refuses',
      should: 'rollback every nested write with outer operation',
      actual: { refused, changed: row.resolution === 'early-nested-commit' },
      expected: { refused: true, changed: false },
    });
  });
});

test('retained lazy queries cannot execute after success', async () => {
  await withBoundedRound(async (f, run, round) => {
    let later: (() => Promise<unknown>) | undefined;
    await run(async (tx) => {
      const query = tx.execute(
        sql`update rounds set resolution=${'late-lazy'} where id=${round}`,
      );
      later = async () => await query;
    });
    await assertRejects({
      given: 'a lazy query created during an already successful callback',
      should: 'refuse executing it after callback disposal',
      actual: () => later!(),
      code: 'INVARIANT',
    });
    const [row] = await f.sql`select resolution from rounds where id=${round}`;
    assert({
      given: 'an escaped lazy query',
      should: 'preserve the committed transcript state',
      actual: row.resolution === 'late-lazy',
      expected: false,
    });
  });
});

for (const command of [
  'COMMIT',
  'END',
  'ROLLBACK',
  'ABORT',
  'BEGIN',
  'START TRANSACTION',
  'SAVEPOINT escape',
  'RELEASE SAVEPOINT escape',
  'ROLLBACK TO SAVEPOINT escape',
  '-- comment\n/* nested /* comment */ done */ COMMIT',
  "SELECT set_config('statement_timeout','0',true)",
]) {
  test(`callback cannot take transaction control through ${command.split('\n').at(-1)}`, async () => {
    await withBoundedRound(async (f, run, round) => {
      await assertRejects({
        given: `a callback issuing ${command}`,
        should:
          'refuse and roll back its prior write even when the callback catches the refusal',
        code: 'INVARIANT',
        actual: () =>
          run(async (tx) => {
            await tx.execute(
              sql`update rounds set resolution=${'control-escape'} where id=${round}`,
            );
            try {
              await tx.execute(sql.raw(command));
            } catch {
              /* Fault injection: callback deliberately swallows the SQL/control refusal. */
            }
          }),
      });
      const [row] =
        await f.sql`select resolution from rounds where id=${round}`;
      assert({
        given: 'refused manual transaction control',
        should: 'preserve the original row',
        actual: row.resolution === 'control-escape',
        expected: false,
      });
    });
  });
}

test(
  'callback scope is closed while the owned commit is still in flight',
  async () =>
    withPool(async (client) => {
      const reserve = client.reserve.bind(client);
      const committing = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      let count = 0;
      client.reserve = async (options) => {
        const native = await reserve(options);
        count += 1;
        if (count !== 2) return native;
        return new Proxy(native, {
          apply(target, receiver, args) {
            if (args[0].join('') !== 'commit')
              return Reflect.apply(target, receiver, args);
            committing.resolve();
            return release.promise.then(() =>
              Reflect.apply(target, receiver, args),
            );
          },
        });
      };
      let escaped: BoundedTransactionContext | undefined;
      const run = createBoundedTransaction({
        client,
        maxConnections: 4,
        now: performance.now,
      });
      const result = run(async (tx) => {
        escaped = tx;
        await tx.execute(sql`select 1`);
        return 42;
      });
      await committing.promise;
      try {
        await assertRejects({
          given:
            'callback return has started commit but not released its reservation',
          should: 'refuse any detached query during commit',
          actual: () => escaped!.execute(sql`select 1`),
          code: 'INVARIANT',
        });
      } finally {
        release.resolve();
      }
      assert({
        given: 'a detached query was refused during the commit window',
        should: 'preserve the original successful transaction result',
        actual: await result,
        expected: 42,
      });
    }),
  15000,
);

for (const command of ['SELECT 1; COMMIT', 'SELECT 1; END']) {
  test(`prepared protocol refuses multiple statements including ${command}`, async () =>
    withPool(async (client) => {
      const run = createBoundedTransaction({
        client,
        maxConnections: 4,
        now: performance.now,
      });
      await assertRejects({
        given: 'manual control hidden after a permitted first statement',
        should:
          'refuse the whole prepared statement before any control executes',
        actual: () =>
          run(async (tx) => {
            await tx.execute(sql.raw(command));
          }),
        code: 'INFRASTRUCTURE',
      });
    }));
}
