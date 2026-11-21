import { SQL } from 'bun';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { createId } from '@paralleldrive/cuid2';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { hydrateRoundRows } from '../src/round-hydration';
import { roundOperations } from '../src/round-operations';
import { withFixture } from './constraint-helpers';
import { validRules } from './round-fixtures';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

test('Round creation pins stored rules, and hydration uses a real read-only repeatable snapshot', async () => {
  await withFixture(url, async (fixture) => {
    const id = createId();
    fixture.track('rounds', id);
    const formatId = await fixture.format();
    const client = new SQL(url);
    const store = drizzle({ client });
    const operations = roundOperations({
      database: store,
      eventSink: undefined,
    });
    const input = {
      id,
      createdByActorId: null,
      resolution: 'Initial Round resolution',
      competitionType: 'casual' as const,
      formatId,
      formatVersion: 1,
      presetVersion: null,
      rules: validRules,
    };
    try {
      await operations.createRound(input);
      await assertRejects({
        given: 'the already-persisted Round identity',
        should: 'surface the actual unique violation as a conflict',
        actual: () => operations.createRound(input),
        code: 'CONFLICT',
      });
      const transaction = store.transaction.bind(store);
      const snapshots: unknown[] = [];
      store.transaction = (work, config) =>
        transaction(async (tx) => {
          const [settings] = await tx.execute(
            sql`select current_setting('transaction_isolation') as isolation, current_setting('transaction_read_only') as read_only, version from rounds where id=${id}`,
          );
          snapshots.push(settings);
          await fixture.sql`update rounds set resolution = 'New resolution', version = version + 1 where id=${id}`;
          return work(tx);
        }, config);
      const before = await operations.getRound(id);
      store.transaction = transaction;
      const after = await operations.getRound(id);
      assert({
        given:
          'a concurrent persisted edit during the read-only hydration snapshot of a freshly created Round',
        should:
          'hydrate the frozen rules, empty runtime and children under the original version, and see the new version in a new read',
        actual: [
          snapshots,
          before?.rules,
          before?.checkpoint.version,
          before?.participants,
          before?.segments,
          before?.resolution,
          before?.version,
          after?.resolution,
          after?.version,
        ],
        expected: [
          [{ isolation: 'repeatable read', read_only: 'on', version: 1 }],
          validRules,
          1,
          [],
          [],
          input.resolution,
          1,
          'New resolution',
          2,
        ],
      });
    } finally {
      await client.close();
    }
  });
});

test('unlocked Round hydration retries a real interleaved version and bounds persistent churn', async () => {
  await withFixture(url, async (fixture) => {
    const id = await fixture.round();
    const client = new SQL(url);
    const db = drizzle({ client });
    const unsafe = client.unsafe.bind(client);
    let moves = 0;
    const interleave = () => {
      moves--;
      return fixture.sql`update rounds set version=version+1 where id=${id}`;
    };
    client.unsafe = (statement, params, options) => {
      const query = unsafe(statement, params, options);
      if (!statement.includes('from "round_participants"') || moves <= 0)
        return query;
      return new Proxy(query, {
        get(target, property, receiver) {
          if (property === 'values')
            return async () => {
              await interleave();
              return target.values();
            };
          return Reflect.get(target, property, receiver);
        },
      });
    };
    try {
      moves = 1;
      const steady = await hydrateRoundRows(db, id);
      assert({
        given: 'a real edit between the parent and child reads',
        should: 'retry to a stable second revision',
        actual: [steady?.version, moves],
        expected: [2, 0],
      });
      moves = 4;
      await assertRejects({
        given: 'a real new revision on every allowed attempt',
        should: 'refuse the persistently unstable hydration',
        actual: () => hydrateRoundRows(db, id),
        code: 'INFRASTRUCTURE',
      });
      assert({
        given: 'the unstable read',
        should: 'consume exactly its four attempts',
        actual: moves,
        expected: 0,
      });
    } finally {
      await client.close();
    }
  });
});
