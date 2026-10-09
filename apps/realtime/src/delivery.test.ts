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
