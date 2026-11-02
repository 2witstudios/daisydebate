import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { sql } from 'drizzle-orm';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createBoundedTransaction } from '../src/bounded-transaction';
import { testLane } from '../src/testing-lane';
import { withPool } from './bounded-transaction.test-support';

setupRitewayBun();
requireTestServices(process.env);

/** Unhandled-rejection notices arrive after event-loop turns; no timed sleep. */
const settleEventLoop = async () => {
  await new Promise(setImmediate);
  await new Promise(setImmediate);
};

const MARKER = '7654321';
/** Crosses the injected clock just after the native lazy query is constructed. */
function crossBudgetAfterMarker(
  client: Parameters<Parameters<typeof withPool>[0]>[0],
  advance: () => void,
) {
  const reserve = client.reserve.bind(client);
  let reservations = 0;
  client.reserve = async (options) => {
    const connection = await reserve(options);
    // The second reservation is the writer's work connection.
    if (++reservations !== 2) return connection;
    return new Proxy(connection, {
      apply(target, receiver, args) {
        const query = Reflect.apply(target, receiver, args);
        const template = args[0];
        if (Array.isArray(template) && template.join('').includes(MARKER))
          advance();
        return query;
      },
    });
  };
}

async function runMarker(cross: boolean) {
  const unhandled: unknown[] = [];
  const listener = (error: unknown) => unhandled.push(error);
  process.on('unhandledRejection', listener);
  let outcome = 'committed';
  try {
    await withPool(async (client) => {
      let elapsed = 0;
      if (cross)
        crossBudgetAfterMarker(client, () => {
          elapsed = 900;
        });
      const lane = testLane(client, 4);
      const run = createBoundedTransaction({
        lane,
        now: () => elapsed,
        executionMs: 900,
      });
      const attempt = run(async (tx) => {
        await tx.execute(sql.raw(`select ${MARKER} as marker`));
      });
      if (cross)
        await assertRejects({
          given: 'a deadline crossing before lazy query consumption',
          should: 'retain the budget refusal as the outcome',
          actual: () => attempt,
          code: 'INFRASTRUCTURE',
        });
      else await attempt;
      if (cross) outcome = 'refused';
      await settleEventLoop();
      assert({
        given: 'the attempt settled',
        should: 'release its admitted capacity',
        actual: lane.gate.stats().active,
        expected: 0,
      });
    });
    await settleEventLoop();
  } finally {
    process.off('unhandledRejection', listener);
  }
  return { outcome, unhandled };
}

test('ISSUE-889: every native query has an observed terminal outcome', async () => {
  assert({
    given: 'no deadline crossing (control)',
    should: 'commit with no unhandled rejection',
    actual: await runMarker(false),
    expected: { outcome: 'committed', unhandled: [] },
  });
  assert({
    given:
      'a deadline crossing after native construction and before guarded consumption',
    should: 'refuse without an unhandled rejection from writer close',
    actual: await runMarker(true),
    expected: { outcome: 'refused', unhandled: [] },
  });
});

test('ISSUE-889: observing a query does not execute it', async () => {
  await withPool(async (client) => {
    let elapsed = 0;
    crossBudgetAfterMarker(client, () => {
      elapsed = 900;
    });
    const table = `ownership_probe_${Bun.randomUUIDv7().replaceAll('-', '')}`;
    await client.unsafe(`create table ${table}(value int)`);
    try {
      const run = createBoundedTransaction({
        lane: testLane(client, 4),
        now: () => elapsed,
        executionMs: 900,
      });
      await assertRejects({
        given: 'a write refused at guarded consumption',
        should: 'refuse it',
        actual: () =>
          run(async (tx) => {
            await tx.execute(sql.raw(`insert into ${table} select ${MARKER}`));
          }),
        code: 'INFRASTRUCTURE',
      });
      const [row] = await client.unsafe(
        `select count(*)::int as n from ${table}`,
      );
      assert({
        given: 'the refused write',
        should: 'never have reached PostgreSQL',
        actual: row.n,
        expected: 0,
      });
    } finally {
      await client.unsafe(`drop table ${table}`);
    }
  });
});
