import { virtualClock } from '@daisy/clock/testing';
import { SQL } from 'bun';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { laneClient } from './lane-client';
import { createLaneGate } from './workload';

setupRitewayBun();

const inertPool = () => new SQL('postgres://lane@127.0.0.1:1/lane');

test('pool lifecycle members are not reachable through a lane', () => {
  const client = laneClient(
    inertPool(),
    createLaneGate(
      'social',
      { connections: 1, queue: 0, maxWaitMs: 1 },
      virtualClock(),
    ),
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
  const client = laneClient(
    inertPool(),
    createLaneGate(
      'social',
      { connections: 1, queue: 0, maxWaitMs: 1 },
      virtualClock(),
    ),
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
  const gate = createLaneGate(
    'social',
    { connections: 1, queue: 0, maxWaitMs: 1 },
    virtualClock(),
  );
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
    inertPool(),
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

test('a lane client is not a thenable and has no symbol members', async () => {
  const client = laneClient(
    inertPool(),
    createLaneGate(
      'social',
      { connections: 1, queue: 0, maxWaitMs: 1 },
      virtualClock(),
    ),
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
