import type { SQL } from 'bun';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { laneClient } from './lane-client';
import { createLaneGate } from './workload-admission';

setupRitewayBun();

/** A scripted pool that records peak concurrency; queries settle on `finish()`. */
function scriptedPool() {
  let running = 0;
  let peak = 0;
  const pending: (() => void)[] = [];
  const run = (rows: unknown[]) => {
    running += 1;
    peak = Math.max(peak, running);
    return new Promise<unknown[]>((resolve) =>
      pending.push(() => {
        running -= 1;
        resolve(rows);
      }),
    );
  };
  const lazy = (rows: unknown[]) => ({
    then: (fulfilled: (value: unknown) => unknown) => run(rows).then(fulfilled),
    values: () => run([rows]),
  });
  let released = 0;
  const pool = Object.assign((..._args: unknown[]) => lazy(['tag']), {
    options: {},
    unsafe: () => lazy(['unsafe']),
    begin: (work: (tx: unknown) => Promise<unknown>) => work('tx'),
    reserve: () =>
      Promise.resolve({
        release: () => {
          released += 1;
        },
        close: () => Promise.resolve(),
      }),
    listen: () => Promise.resolve(),
  });
  return {
    pool: pool as unknown as SQL,
    finishAll: () => pending.splice(0).forEach((finish) => finish()),
    observed: () => ({ running, peak, released }),
  };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('a lane-bound client never runs more queries than its lane holds', async () => {
  const script = scriptedPool();
  const gate = createLaneGate('social', {
    connections: 2,
    queue: 8,
    maxWaitMs: 1000,
  });
  const client = laneClient(script.pool, gate);
  const queries = [
    client`select 1`,
    client.unsafe('select 2'),
    client.unsafe('select 3').values(),
    client`select 4`.values(),
  ].map((query) => Promise.resolve(query));
  await tick();
  const first = script.observed().running;
  while (gate.stats().active > 0 || gate.stats().waiting > 0) {
    script.finishAll();
    await tick();
  }
  await Promise.all(queries);
  assert({
    given: 'four tagged, unsafe and values() queries on a two-connection lane',
    should: 'run at most two at a time and return every slot',
    actual: { first, peak: script.observed().peak, stats: gate.stats() },
    expected: { first: 2, peak: 2, stats: { active: 0, waiting: 0 } },
  });
});

test('a reservation holds its lane slot until it is released', async () => {
  const script = scriptedPool();
  const gate = createLaneGate('competitive', {
    connections: 1,
    queue: 1,
    maxWaitMs: 1000,
  });
  const client = laneClient(script.pool, gate);
  const reserved = await client.reserve();
  const held = gate.stats().active;
  reserved.release();
  reserved.release();
  assert({
    given: 'a reserved connection released twice',
    should: 'hold one slot while reserved and return it exactly once',
    actual: { held, after: gate.stats().active },
    expected: { held: 1, after: 0 },
  });
});

test('a transaction holds one slot for its whole body', async () => {
  const script = scriptedPool();
  const gate = createLaneGate('social', {
    connections: 1,
    queue: 1,
    maxWaitMs: 1000,
  });
  const client = laneClient(script.pool, gate);
  let during = -1;
  await client.begin(async () => {
    during = gate.stats().active;
  });
  assert({
    given: 'a transaction body on a one-connection lane',
    should: 'see its slot held, then released when it settles',
    actual: { during, after: gate.stats().active },
    expected: { during: 1, after: 0 },
  });
});

test('pool lifecycle members are not reachable through a lane', () => {
  const script = scriptedPool();
  const client = laneClient(
    script.pool,
    createLaneGate('social', { connections: 1, queue: 0, maxWaitMs: 1 }),
  );
  const refused = (member: 'listen' | 'close') => {
    try {
      (client[member] as () => unknown)();
      return 'reached';
    } catch (error) {
      return (error as Error).message;
    }
  };
  assert({
    given: 'LISTEN and close called on a lane-bound client',
    should: 'refuse both: they belong to the admission owner',
    actual: [refused('listen'), refused('close')],
    expected: [
      'A lane-bound client does not offer listen',
      'A lane-bound client does not offer close',
    ],
  });
});
