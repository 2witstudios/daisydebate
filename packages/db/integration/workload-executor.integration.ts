import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { sql, defineRelations } from 'drizzle-orm';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { requireTestServices } from '@daisy/config';
import {
  createWorkloadExecutor,
  workloadDatabase,
} from '../src/workload-executor';
import { RUNTIME_SESSION } from '../src/session-bounds';
import { users } from '../src/schema/users';
import { finishedOrBlockedBehind } from '../src/testing';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

test('installed Drizzle raw/prepared/relational execution paths retain reservations and isolate lanes', async () => {
  const client = new SQL(url, { max: 2, connection: RUNTIME_SESSION });
  const holder = new SQL(url, { max: 1 });
  const observer = new SQL(url, { max: 1 });
  const raw = drizzle({ client, relations: defineRelations({ users }) });
  const executor = createWorkloadExecutor({ social: 1, competitive: 1 });
  const social = workloadDatabase(raw, executor, 'social');
  const competitive = workloadDatabase(raw, executor, 'competitive');
  try {
    await holder.begin(async (tx) => {
      const [{ pid }] = await tx`select pg_backend_pid() pid`;
      await tx`select pg_advisory_xact_lock(8771241)`;
      const held = social.execute(sql`select pg_advisory_xact_lock(8771241)`);
      const blocking = await finishedOrBlockedBehind(held, observer, pid, {
        now: Date.now,
      });
      await assertRejects({
        given: 'social SQL observed waiting at PostgreSQL',
        should: 'refuse prepared execution before its SQL starts',
        actual: () =>
          social
            .select({ id: users.id })
            .from(users)
            .prepare('busy_probe')
            .execute(),
        code: 'INFRASTRUCTURE',
      });
      await assertRejects({
        given: 'social SQL observed waiting at PostgreSQL',
        should: 'refuse nested relational query execution',
        actual: () => social.query.users.findMany({ limit: 1 }),
        code: 'INFRASTRUCTURE',
      });
      const progress = await competitive.execute(sql`select 1 as value`);
      let refused = false;
      try {
        await held;
      } catch {
        refused = true;
      }
      assert({
        given: 'installed driver/query builders under social contention',
        should: 'preserve competitive progress and settle bounded SQL failure',
        actual: { blocking, progress: progress[0]?.value, refused },
        expected: { blocking: 'blocked', progress: 1, refused: true },
      });
    });
    const rows = await social
      .select({ id: users.id })
      .from(users)
      .prepare('settled_probe')
      .execute();
    assert({
      given: 'settled driver failure',
      should: 'release its lane for prepared SQL',
      actual: Array.isArray(rows),
      expected: true,
    });
    let child: typeof social | undefined;
    await social.transaction(async (tx) => {
      child = tx as unknown as typeof social;
      await tx.execute(sql`select 1`);
      await assertRejects({
        given: 'an active owning transaction',
        should: 'refuse a nested transaction',
        actual: () => tx.transaction(async () => true),
        code: 'INFRASTRUCTURE',
      });
    });
    await assertRejects({
      given: 'a captured transaction after commit',
      should: 'refuse escaped child SQL',
      actual: () => child!.execute(sql`select 1`),
      code: 'INFRASTRUCTURE',
    });
    await assertRejects({
      given: 'a scoped database',
      should: 'refuse raw driver access',
      actual: () => Reflect.get(social, '$client'),
      code: 'INFRASTRUCTURE',
    });
  } finally {
    await Promise.allSettled([
      client.close(),
      holder.close(),
      observer.close(),
    ]);
  }
});
