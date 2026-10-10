import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { RealtimeApp } from './app';
import { createRealtimeDelivery } from './delivery';

setupRitewayBun();
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
    database: {
      resolveRealtimeSession: () =>
        new Promise((done) => {
          resolve = done;
        }),
    },
  } as unknown as RealtimeApp;
  const delivery = createRealtimeDelivery({
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
    database: {
      readAuthorizationSession: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    },
    clock: { now: () => '2026-10-09T00:00:00.000Z' },
  } as unknown as RealtimeApp;
  const delivery = createRealtimeDelivery({
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
  const allowed = await checked;
  finish({ expiresAt: '2026-10-09T00:01:00.000Z' });
  await Promise.resolve();
  assert({
    given:
      'the actual delivery validation port with a late current-session read',
    should:
      'return refusal and clear its timer before that late allow can complete',
    actual: [allowed, cleared],
    expected: [false, true],
  });
});
