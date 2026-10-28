import { SQL } from 'bun';
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

/** Every member a real Bun `SQL` pool carries, own and inherited; building one dials nothing. */
const bunSqlMembers = (): PropertyKey[] => {
  const members = new Set<PropertyKey>();
  for (
    let level: object | null = new SQL('postgres://lane@127.0.0.1:1/lane');
    level !== null && level !== Function.prototype;
    level = Object.getPrototypeOf(level) as object | null
  )
    for (const member of Reflect.ownKeys(level)) members.add(member);
  return [...members];
};

test('every Bun SQL member is either admitted through the lane or refused', () => {
  const script = scriptedPool();
  const client = laneClient(
    script.pool,
    createLaneGate('social', { connections: 1, queue: 0, maxWaitMs: 1 }),
  );
  const reach = (member: PropertyKey) => {
    const value: unknown = Reflect.get(client, member);
    if (value === undefined) return 'refused';
    if (typeof value !== 'function') return 'value';
    try {
      (value as () => unknown)();
      return 'reached';
    } catch (error) {
      return (error as Error).message.startsWith(
        'A lane-bound client does not offer',
      )
        ? 'refused'
        : 'reached';
    }
  };
  const admitted = ['begin', 'options', 'reserve', 'transaction', 'unsafe'];
  const surface = bunSqlMembers();
  assert({
    given: "every member of Bun's SQL surface, read through a lane",
    should:
      'reach only the admitted query, transaction, reservation and options members; refuse the rest, including any member Bun adds later',
    actual: surface
      .filter((member) => !admitted.includes(member as string))
      .map((member) => [String(member), reach(member)])
      .filter(([, reached]) => reached !== 'refused'),
    expected: [],
  });
});

test('distributed transactions and NOTIFY cannot run past a full lane', async () => {
  const script = scriptedPool();
  const gate = createLaneGate('social', {
    connections: 1,
    queue: 0,
    maxWaitMs: 1,
  });
  const raw: string[] = [];
  const members = [
    'beginDistributed',
    'commitDistributed',
    'rollbackDistributed',
    'notify',
    'distributed',
    'array',
  ];
  const pool = Object.assign(
    script.pool,
    Object.fromEntries(
      members.map((member) => [member, () => void raw.push(member)]),
    ),
  );
  const client = laneClient(pool, gate);
  const held = await gate.admit(1);
  const attempt = (member: string) => {
    try {
      (Reflect.get(client, member) as (...args: unknown[]) => unknown)('x');
      return 'ran';
    } catch (error) {
      return (error as Error).message;
    }
  };
  const outcome = members.map(attempt);
  held();
  assert({
    given: 'a saturated lane and the members a denylist forgot',
    should: 'refuse each without touching the pool or the gate',
    actual: { outcome, raw, stats: gate.stats() },
    expected: {
      outcome: [
        'A lane-bound client does not offer beginDistributed',
        'A lane-bound client does not offer commitDistributed',
        'A lane-bound client does not offer rollbackDistributed',
        'A lane-bound client does not offer notify',
        'A lane-bound client does not offer distributed',
        'A lane-bound client does not offer array',
      ],
      raw: [],
      stats: { active: 0, waiting: 0 },
    },
  });
});

test('two networks queued on one lane are served alternately', async () => {
  const script = scriptedPool();
  const gate = createLaneGate('social', {
    connections: 1,
    queue: 8,
    maxWaitMs: 1000,
  });
  let network = 'flood';
  const client = laneClient(script.pool, gate, () => network);
  const held = await gate.admit(1);
  const served: string[] = [];
  const query = (label: string) =>
    client.unsafe('select 1').then(() => void served.push(label));
  const queued = [query('flood-1'), query('flood-2'), query('flood-3')];
  network = 'other';
  queued.push(query('other-1'));
  held();
  for (let step = 0; step < 8; step += 1) {
    await tick();
    script.finishAll();
  }
  await Promise.all(queued);
  assert({
    given: 'three queued queries from one network, then one from another',
    should: 'serve the other network second, not behind the whole flood',
    actual: served,
    expected: ['flood-1', 'other-1', 'flood-2', 'flood-3'],
  });
});

test('a lane client is not a thenable and has no symbol members', async () => {
  const script = scriptedPool();
  const client = laneClient(
    script.pool,
    createLaneGate('social', { connections: 1, queue: 0, maxWaitMs: 1 }),
  );
  const returned = await (async () => client)();
  assert({
    given: 'a lane client returned from an async function, and its symbol keys',
    should:
      'resolve to the client itself and expose no then, async disposal or coercion',
    actual: {
      same: returned === client,
      then: Reflect.get(client, 'then'),
      dispose: Reflect.get(client, Symbol.asyncDispose),
      primitive: Reflect.get(client, Symbol.toPrimitive),
    },
    expected: {
      same: true,
      then: undefined,
      dispose: undefined,
      primitive: undefined,
    },
  });
});
