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

test('a subscribe refused by a lane logs the lane and reason', async () => {
  const logged: unknown[] = [];
  const sent: unknown[] = [];
  const resources = {
    database: bothLanes({
      readAuthorizationSession: () =>
        Promise.reject(
          refuseCapacity({
            lane: 'admission',
            reason: 'expired',
            pressure: { pending: 2, running: 1, oldestAgeMs: 400 },
          }),
        ),
    }),
    clock: { now: () => '2026-10-09T00:00:00.000Z' },
    logger: {
      log: (event: string, fields: unknown) => logged.push([event, fields]),
    },
  } as unknown as RealtimeApp;
  const { registry } = createRealtimeDelivery({
    readingPolicy: refuseAllReading,
    resources,
    now: () => 0,
    publish: () => {},
    timers: {
      setInterval: () => ({}) as ReturnType<typeof setInterval>,
      clearInterval: () => {},
    },
  });
  const connection = registry.add(
    {
      bufferedAmount: () => 0,
      send: (frame) => sent.push(frame),
      subscribe: () => {},
      unsubscribe: () => {},
      close: () => {},
    },
    {
      actorId: 'a'.repeat(24),
      userId: 'b'.repeat(24),
      sessionId: 'c'.repeat(24),
    },
  );
  await registry.subscribe(connection, {
    id: 'first',
    topic: `round:${'d'.repeat(24)}`,
  });
  assert({
    given: 'a first subscribe whose authority read a lane refuses',
    should: 'log the code, lane, reason and pressure',
    actual: logged,
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
    actual: sent.map((frame) => (frame as { code?: string }).code),
    expected: ['INFRASTRUCTURE'],
  });
});

test('a subscribe whose budget is spent stops before taking the lane again', async () => {
  let fire!: () => void;
  let finishSession!: (value: unknown) => void;
  let factsReads = 0;
  const instant = '2026-10-09T00:00:00.000Z';
  const resources = {
    database: bothLanes({
      readAuthorizationSession: () =>
        new Promise((resolve) => {
          finishSession = resolve;
        }),
      readRoundAuthorizationFacts: async () => {
        factsReads += 1;
        return null;
      },
    }),
    clock: { now: () => instant },
    logger: { log: () => {} },
  } as unknown as RealtimeApp;
  const { registry } = createRealtimeDelivery({
    readingPolicy: refuseAllReading,
    resources,
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
  const principal = {
    actorId: 'a'.repeat(24),
    userId: 'b'.repeat(24),
    sessionId: 'c'.repeat(24),
  };
  const sent: unknown[] = [];
  const connection = registry.add(
    {
      bufferedAmount: () => 0,
      send: (frame) => sent.push(frame),
      subscribe: () => {},
      unsubscribe: () => {},
      close: () => {},
    },
    principal,
  );
  const subscribing = registry.subscribe(connection, {
    id: 'first',
    topic: `round:${'d'.repeat(24)}`,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  fire();
  await subscribing;
  finishSession({
    ...principal,
    expiresAt: '2026-10-09T01:00:00.000Z',
    account: {
      userId: principal.userId,
      actorId: principal.actorId,
      member: true,
      erased: false,
      revision: 1,
      beta: { state: 'approved', revision: 1 },
      ageBand: 'adult',
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert({
    given: 'a budget spent while the first of three reads is pending',
    should: 'refuse as transient and never start the next read',
    actual: {
      factsReads,
      codes: sent.map((frame) => (frame as { code?: string }).code),
    },
    expected: { factsReads: 0, codes: ['INFRASTRUCTURE'] },
  });
});
