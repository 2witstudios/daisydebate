import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { sampleRoundExecutionTime } from '../src/round-execution-time';
import {
  authoredRoundCommand,
  withAuthoredRound,
} from './round-command.test-support';
setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);
const instant = '2026-10-07T12:00:00.000Z';

test('the database clock is the default and trusted Round time bypasses SQL', async () => {
  const client = new SQL(url, { max: 1 });
  try {
    const statements: string[] = [];
    const database = drizzle({
      client,
      logger: { logQuery: (statement) => statements.push(statement) },
    });
    const [{ before }] = await client`select clock_timestamp() as before`;
    const actual = await sampleRoundExecutionTime(database);
    const [{ after }] = await client`select clock_timestamp() as after`;
    const controlled = await sampleRoundExecutionTime(
      database,
      async () => instant,
    );
    await assertRejects({
      given: 'a trusted resource with an offset timestamp',
      should: 'require canonical UTC',
      actual: () =>
        sampleRoundExecutionTime(
          database,
          async () => '2026-10-07T13:00:00+01:00',
        ),
      code: 'INVARIANT',
    });
    assert({
      given: 'the default database time and then two explicit time resources',
      should:
        'sample between the two PostgreSQL witnesses and use SQL only by default',
      actual: {
        between:
          Date.parse(actual) >= before.getTime() &&
          Date.parse(actual) <= after.getTime(),
        controlled,
        clockReads: statements.filter((query) =>
          query.includes('clock_timestamp'),
        ).length,
        statements: statements.length,
      },
      expected: {
        between: true,
        controlled: instant,
        clockReads: 1,
        statements: 1,
      },
    });
  } finally {
    await client.close();
  }
});

test('Round lifecycle samples after lock acquisition and survives a delayed write exactly', async () => {
  await withAuthoredRound(url, {}, async (fixture, authored) => {
    const { actorId, roundId, database } = authored;
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
    let operation: Promise<unknown> | undefined;
    try {
      await blocker.unsafe('select pg_advisory_lock(hashtextextended($1, 0))', [
        roundId,
      ]);
      await blocker.unsafe('begin');
      await blocker.unsafe('select id from rounds where id = $1 for update', [
        roundId,
      ]);
      operation = database.executeRoundCommand({
        ...authoredRoundCommand({ roundId, actorId }, 1),
        buildProjection: ({ now }) => {
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

test('a scheduled forfeit persists abandonment without a start instant or ballot', async () => {
  await withAuthoredRound(url, {}, async (fixture, authored) => {
    const { actorId, roundId, database } = authored;
    const participant = await fixture.seat(roundId, 'affirmative', 0, actorId);
    try {
      const before = await database.getRound(roundId);
      if (!before) throw new Error('the new round did not hydrate');
      await database.executeRoundCommand({
        ...authoredRoundCommand({ roundId, actorId }, before.version, {
          type: 'forfeit',
          participantId: participant.id,
        }),
        buildProjection: () => ({
          round: {
            status: 'abandoned',
            currentStage: null,
            startedAt: null,
            completedAt: instant,
            outcome: null,
            checkpoint: before.checkpoint,
          },
          segmentInserts: [],
          segmentCloses: [],
          effects: [],
        }),
      });
      const after = await database.getRound(roundId);
      assert({
        given: 'the scheduled forfeit projection at the PostgreSQL boundary',
        should: 'persist the lifecycle the schema allows',
        actual: [
          after?.status,
          after?.startedAt,
          after?.outcome,
          !!after?.completedAt,
        ],
        expected: ['abandoned', null, null, true],
      });
    } finally {
      await database.close();
    }
  });
});
