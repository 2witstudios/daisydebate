import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createDatabase } from '../src';
import { withFixture } from './constraint-helpers';
setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

test('Round lifecycle samples after lock acquisition and survives a delayed write exactly', async () => {
  await withFixture(url, async (fixture) => {
    const roundId = await fixture.round();
    const database = createDatabase({ url, nextActorId: createId });
    const blocker = await fixture.sql.reserve();
    const callbackEntered = Promise.withResolvers<string>();
    const before = await database.getRound(roundId);
    if (!before) throw new Error('Round vanished');
    const trigger = `clock_barrier_${roundId}`;
    await fixture.sql.unsafe(
      `create function ${trigger}() returns trigger language plpgsql as $$ begin perform pg_advisory_xact_lock(hashtextextended(new.id, 0)); return new; end $$`,
    );
    await fixture.sql.unsafe(
      `create trigger ${trigger} before update on rounds for each row when (new.id = '${roundId}') execute function ${trigger}()`,
    );
    let operation: Promise<void> | undefined;
    try {
      await blocker.unsafe('select pg_advisory_lock(hashtextextended($1, 0))', [
        roundId,
      ]);
      await blocker.unsafe('begin');
      await blocker.unsafe('select id from rounds where id = $1 for update', [
        roundId,
      ]);
      operation = database.applyRoundExecution({
        roundId,
        expectedVersion: 1,
        command: null,
        buildProjection: (now) => {
          callbackEntered.resolve(now);
          return {
            round: {
              status: 'active',
              currentStage: 'countdown',
              startedAt: now,
              completedAt: null,
              outcome: null,
              checkpoint: before.checkpoint,
            },
            segmentInserts: [],
            segmentCloses: [],
            effects: [],
          };
        },
      });
      // Observe the actual lock wait before releasing it, with a bounded query loop.
      let waiting = false;
      for (let attempt = 0; attempt < 500 && !waiting; attempt += 1) {
        const [row] = await fixture.sql.unsafe(
          "select exists(select 1 from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%rounds%') as waiting",
        );
        waiting = row.waiting;
      }
      assert({
        given: 'a Round row locked by a concurrent transaction',
        should: 'actually wait before sampling',
        actual: waiting,
        expected: true,
      });
      const [unlockedAfter] = await blocker.unsafe(
        'select clock_timestamp() as now',
      );
      await blocker.unsafe('commit');
      const sampled = await callbackEntered.promise;
      const [delayed] = await fixture.sql.unsafe(
        'select clock_timestamp() as now',
      );
      let writeWaiting = false;
      for (let attempt = 0; attempt < 500 && !writeWaiting; attempt += 1) {
        const [row] = await fixture.sql.unsafe(
          "select exists(select 1 from pg_stat_activity where datname = current_database() and wait_event = 'advisory') as waiting",
        );
        writeWaiting = row.waiting;
      }
      assert({
        given: 'a synchronous projection followed by a blocked SQL writer',
        should: 'hold the sampled instant across a real write delay',
        actual: writeWaiting,
        expected: true,
      });
      await blocker.unsafe(
        'select pg_advisory_unlock(hashtextextended($1, 0))',
        [roundId],
      );
      await operation;
      const hydrated = await database.getRound(roundId);
      assert({
        given: 'a lock wait followed by SQL-trigger-held delayed write',
        should: 'persist the one post-lock instant unchanged',
        actual: {
          exact: hydrated?.startedAt === sampled,
          afterLock: Date.parse(sampled) >= unlockedAfter.now.getTime(),
          beforeWrite: Date.parse(sampled) <= delayed.now.getTime(),
        },
        expected: { exact: true, afterLock: true, beforeWrite: true },
      });
    } finally {
      await blocker.unsafe(
        'select pg_advisory_unlock(hashtextextended($1, 0))',
        [roundId],
      );
      await blocker.unsafe('rollback');
      blocker.release();
      await operation?.catch(() => undefined);
      await fixture.sql.unsafe(
        `drop trigger ${trigger} on rounds; drop function ${trigger}()`,
      );
      await database.close();
    }
  });
});
