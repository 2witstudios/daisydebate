import { hostWaits } from '@daisy/worker/host';
import { requireTestServices } from '@daisy/config';
import { SQL } from 'bun';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { laneClient } from '../src/lane-client';
import { createLaneGate } from '../src/workload';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

const pool = (max: number) => new SQL(databaseUrl, { max });

test('the lane admits at most two of four actual tagged, raw and values queries', async () => {
  const backend = pool(4);
  const observer = pool(2);
  const gate = createLaneGate(
    'social',
    {
      connections: 2,
      queue: 8,
      maxWaitMs: 5000,
    },
    hostWaits,
  );
  const client = laneClient(backend, gate);
  const barrier = 59281;
  let pending: Promise<unknown>[] = [];
  try {
    await observer.begin(async (writer) => {
      const [{ pid }] = await writer`select pg_backend_pid() as pid`;
      await writer`select pg_advisory_xact_lock(${barrier}::bigint)`;
      const raw = 'select pg_advisory_xact_lock_shared($1::bigint)';
      pending = [
        client`select pg_advisory_xact_lock_shared(${barrier}::bigint)`,
        client.unsafe(raw, [barrier]),
        client.unsafe(raw, [barrier]).values(),
        client`select pg_advisory_xact_lock_shared(${barrier}::bigint)`.values(),
      ].map((query) => Promise.resolve(query));
      void Promise.allSettled(pending);
      let blocked = 0;
      const deadline = performance.now() + 3000;
      while (blocked < 2 && performance.now() < deadline) {
        const [{ count }] =
          await observer`select count(*)::int as count from pg_stat_activity
          where ${pid} = any(pg_blocking_pids(pid))`;
        blocked = count;
        if (blocked < 2) await Bun.sleep(1);
      }
      assert({
        given: 'four calls blocked behind one actual PostgreSQL lock',
        should: 'run only two on PostgreSQL and queue the rest',
        actual: { blocked, stats: gate.stats() },
        expected: { blocked: 2, stats: { active: 2, waiting: 2 } },
      });
    });
    await Promise.all(pending);
    assert({
      given: 'all queries after the real lock is released',
      should: 'return every slot',
      actual: gate.stats(),
      expected: { active: 0, waiting: 0 },
    });
  } finally {
    await Promise.allSettled(pending);
    await Promise.all([backend.close(), observer.close()]);
  }
});

test('a reserved connection and a transaction hold exactly one lane slot until release', async () => {
  const backend = pool(2);
  const gate = createLaneGate(
    'competitive',
    {
      connections: 1,
      queue: 1,
      maxWaitMs: 1000,
    },
    hostWaits,
  );
  const client = laneClient(backend, gate);
  try {
    const reserved = await client.reserve();
    const held = gate.stats().active;
    try {
      await reserved`select 1`;
    } finally {
      reserved.release();
      reserved.release();
    }
    const released = gate.stats().active;
    const during = await client.begin(async (tx) => {
      await tx`select 1`;
      return gate.stats().active;
    });
    assert({
      given: 'a reserved handle released twice followed by a transaction',
      should: 'hold and return exactly one slot for each',
      actual: [held, released, during, gate.stats().active],
      expected: [1, 0, 1, 0],
    });
  } finally {
    await backend.close();
  }
});

test('two networks queued on a lane take alternating turns in PostgreSQL', async () => {
  const backend = pool(2);
  const gate = createLaneGate(
    'social',
    {
      connections: 1,
      queue: 8,
      maxWaitMs: 3000,
    },
    hostWaits,
  );
  let network = 'flood';
  const client = laneClient(backend, gate, () => network);
  const held = await gate.admit(1);
  const served: string[] = [];
  const query = (label: string) =>
    client.unsafe('select 1').then(() => {
      served.push(label);
    });
  try {
    const queued = [query('flood-1'), query('flood-2'), query('flood-3')];
    network = 'other';
    queued.push(query('other-1'));
    held();
    await Promise.all(queued);
    assert({
      given: 'three queries from one network, then a query from another',
      should:
        'serve the other network second, ahead of the first network’s remaining queries',
      actual: served,
      expected: ['flood-1', 'other-1', 'flood-2', 'flood-3'],
    });
  } finally {
    held();
    await backend.close();
  }
});
