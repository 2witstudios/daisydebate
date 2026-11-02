import { assert, setupRitewayBun, test } from 'riteway/bun';
import { refuseCapacity } from '@daisy/db/testing';
import type { RealtimeApp } from './app';
import { createRealtimeDelivery } from './delivery';
import { refuseAllReading } from './authorization.test-support';

setupRitewayBun();

/** One fake authority for both the admission and renewal lanes. */
const bothLanes = <T>(reads: T) => ({ admission: reads, renewal: reads });
test('ticket admission refuses session expiry crossed during the durable await', async () => {
  let instant = '2026-10-09T00:00:00.000Z';
  let resolve!: (value: unknown) => void;
  let consumed = false;
  const resources = {
    clock: { now: () => instant },
    redis: {
      consumeConnectTicket: async () => {
        if (consumed) return { accepted: false };
        consumed = true;
        return {
          accepted: true,
          actorId: 'a'.repeat(24),
          sessionId: 'b'.repeat(24),
        };
      },
    },
    database: bothLanes({
      resolveRealtimeSession: () =>
        new Promise((done) => {
          resolve = done;
        }),
    }),
  } as unknown as RealtimeApp;
  const delivery = createRealtimeDelivery({
    readingPolicy: refuseAllReading,
    resources,
    timers: {
      setInterval: () => {
        throw new Error('Unused authority timer');
      },
      clearInterval: () => {},
    },
    now: () => 0,
    publish: () => {},
  });
  const pending = delivery.authenticate(
    't'.repeat(43),
    'https://app.example.test',
  );
  await Promise.resolve();
  instant = '2026-10-09T00:00:01.000Z';
  resolve({
    actorId: 'a'.repeat(24),
    userId: 'c'.repeat(24),
    sessionId: 'b'.repeat(24),
    expiresAt: instant,
    // An admitted participant (ADR 0075), so only the expiry can refuse.
    account: {
      userId: 'c'.repeat(24),
      actorId: 'a'.repeat(24),
      member: true,
      erased: false,
      revision: 1,
      beta: { state: 'approved', revision: 1 },
      ageBand: 'adult',
    },
  });
  assert({
    given: 'a durable session lookup resolving at its expiry',
    should: 'refuse that admission and the already-consumed ticket',
    actual: [
      await pending,
      await delivery.authenticate('t'.repeat(43), 'https://app.example.test'),
    ],
    expected: [null, null],
  });
});

test('real delivery principal validation refuses a canonical read exceeding its resource budget', async () => {
  let fire!: () => void;
  let cleared = false;
  let finish!: (value: unknown) => void;
  const resources = {
    database: bothLanes({
      readAuthorizationSession: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    }),
    clock: { now: () => '2026-10-09T00:00:00.000Z' },
  } as unknown as RealtimeApp;
  const delivery = createRealtimeDelivery({
    readingPolicy: refuseAllReading,
    resources,
    now: () => 0,
    publish: () => {},
    timers: {
      setInterval: (callback) => {
        fire = callback;
        return {} as ReturnType<typeof setInterval>;
      },
      clearInterval: () => {
        cleared = true;
      },
    },
  });
  const checked = delivery.validatePrincipal({
    actorId: 'a'.repeat(24),
    userId: 'b'.repeat(24),
    sessionId: 'c'.repeat(24),
  });
  await Promise.resolve();
  fire();
  const outcome = await checked.then(
    () => 'answered',
    (error: unknown) => (error instanceof Error ? error.message : 'unknown'),
  );
  finish({ expiresAt: '2026-10-09T00:01:00.000Z' });
  await Promise.resolve();
  assert({
    given:
      'the actual delivery validation port with a late current-session read',
    should:
      'reject as spent budget for the caller to refuse, and clear its timer before that late allow can complete',
    actual: [outcome, cleared],
    expected: ['Authority check budget spent', true],
  });
});

const principal = {
  actorId: 'a'.repeat(24),
  userId: 'b'.repeat(24),
  sessionId: 'c'.repeat(24),
};
const account = {
  ...principal,
  member: true,
  erased: false,
  revision: 1,
  beta: { state: 'approved', revision: 1 },
  ageBand: 'adult',
};
const session = {
  ...principal,
  expiresAt: '2026-10-09T01:00:00.000Z',
  account,
};
const roundId = 'd'.repeat(24);
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The real delivery over fake reads, one connection, and a manual budget timer. */
function subscribeRig(reads: unknown) {
  const logged: unknown[] = [];
  const sent: unknown[] = [];
  let fire = () => {};
  const delivery = createRealtimeDelivery({
    readingPolicy: refuseAllReading,
    resources: {
      database: bothLanes(reads),
      clock: { now: () => '2026-10-09T00:00:00.000Z' },
      logger: {
        log: (event: string, fields: unknown) => logged.push([event, fields]),
      },
    } as unknown as RealtimeApp,
    now: () => 0,
    publish: () => {},
    timers: {
      setInterval: (callback) => {
        fire = callback;
        return {} as ReturnType<typeof setInterval>;
      },
      clearInterval: () => {},
    },
  });
  const connection = delivery.registry.add(
    {
      bufferedAmount: () => 0,
      send: (frame) => sent.push(frame),
      subscribe: () => {},
      unsubscribe: () => {},
      close: () => {},
    },
    principal,
  );
  return {
    delivery,
    logged,
    sent,
    spendBudget: () => fire(),
    subscribe: () =>
      delivery.registry.subscribe(connection, {
        id: 'first',
        topic: `round:${roundId}`,
      }),
  };
}

test('a subscribe refused by a lane logs the lane, reason and pressure', async () => {
  const rig = subscribeRig({
    readAuthorizationSession: () =>
      Promise.reject(
        refuseCapacity({
          lane: 'admission',
          reason: 'expired',
          pressure: { pending: 2, running: 1, oldestAgeMs: 400 },
        }),
      ),
  });
  await rig.subscribe();
  assert({
    given: 'a first subscribe whose authority read a lane refuses',
    should: 'log the code, lane, reason and pressure',
    actual: rig.logged,
    expected: [
      [
        'realtime.subscription.unavailable',
        {
          operation: 'realtime.subscription',
          errorCode: 'INFRASTRUCTURE',
          cause: 'admission.expired',
          pending: 2,
          running: 1,
          oldestAgeMs: 400,
        },
      ],
    ],
  });
  assert({
    given: 'the same refusal',
    should: 'answer the subscriber with the transient code',
    actual: rig.sent.map((frame) => (frame as { code?: string }).code),
    expected: ['INFRASTRUCTURE'],
  });
});

test('an unanswered check logs the operation its caller names', () => {
  const rig = subscribeRig({});
  rig.delivery.reportUnavailable(new Error('private'), 'realtime.hello');
  assert({
    given: 'a hello check reported as failed',
    should: 'log that operation, not the subscription default',
    actual: rig.logged,
    expected: [
      [
        'realtime.subscription.unavailable',
        {
          operation: 'realtime.hello',
          errorCode: 'INTERNAL',
          cause: 'internal',
        },
      ],
    ],
  });
});

test('a subscribe whose budget is spent stops before taking the lane again', async () => {
  let finishSession = (_value: unknown) => {};
  let factsReads = 0;
  const rig = subscribeRig({
    readAuthorizationSession: () =>
      new Promise((resolve) => {
        finishSession = resolve;
      }),
    readRoundAuthorizationFacts: async () => {
      factsReads += 1;
      return null;
    },
  });
  const subscribing = rig.subscribe();
  await settle();
  rig.spendBudget();
  await subscribing;
  finishSession(session);
  await settle();
  assert({
    given: 'a budget spent while the first of three reads is pending',
    should: 'refuse as transient and never start the next read',
    actual: {
      factsReads,
      codes: rig.sent.map((frame) => (frame as { code?: string }).code),
    },
    expected: { factsReads: 0, codes: ['INFRASTRUCTURE'] },
  });
});

test('a subscribe whose budget is spent during the facts read stops before the last read', async () => {
  let finishFacts = (_value: unknown) => {};
  let sessionReads = 0;
  const rig = subscribeRig({
    readAuthorizationSession: async () => {
      sessionReads += 1;
      return session;
    },
    readRoundAuthorizationFacts: () =>
      new Promise((resolve) => {
        finishFacts = resolve;
      }),
  });
  const subscribing = rig.subscribe();
  await settle();
  rig.spendBudget();
  await subscribing;
  finishFacts({
    account,
    resource: {
      kind: 'round',
      roundId,
      createdByActorId: principal.actorId,
      visibility: 'public',
      status: 'scheduled',
      revision: 1,
      participants: [],
    },
  });
  await settle();
  assert({
    given: 'a budget spent during the facts read, which then allows',
    should: 'never start the final session read',
    actual: sessionReads,
    expected: 1,
  });
});
