import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { OUTBOX_ORIGIN, type OutboxPosition, type OutboxRow } from '@daisy/db';
import { serveRealtime } from './serve';
import type { RealtimeApp } from './app';
import { deferred, noopLogger } from './outbox-drain.test-support';

setupRitewayBun();

/**
 * A minimal `RealtimeApp` stand-in: only the fields `serveRealtime` and
 * `createRealtimeServer` actually read. Cast at the boundary, the same
 * pattern `server.test.ts`'s `fakeServer` uses for a Bun `Server`.
 */
function fakeApp(overrides: {
  readonly listenOutbox: () => Promise<{ unlisten: () => Promise<void> }>;
  readonly readOutboxHighWaterMark: () => Promise<OutboxPosition>;
}): RealtimeApp {
  return {
    isDraining: () => false,
    logger: noopLogger,
    database: {
      health: async () => true,
      checkListen: async () => true,
      listenOutbox: overrides.listenOutbox,
      readOutboxHighWaterMark: overrides.readOutboxHighWaterMark,
      drainOutbox: async (): Promise<readonly OutboxRow[]> => [],
    },
    redis: { health: async () => true },
  } as unknown as RealtimeApp;
}

describe('serveRealtime startup order (RT-2.3b review finding 2)', () => {
  test('never calls serve() until both LISTEN and the high-water mark have resolved', async () => {
    const listenGate = deferred<{ unlisten: () => Promise<void> }>();
    const highWaterMarkGate = deferred<OutboxPosition>();
    const resources = fakeApp({
      listenOutbox: async () => listenGate.promise,
      readOutboxHighWaterMark: () => highWaterMarkGate.promise,
    });
    let serveCalled = false;
    const fakeServe = ((): ReturnType<typeof Bun.serve> => {
      serveCalled = true;
      return { port: 0, stop: async () => {} } as unknown as ReturnType<
        typeof Bun.serve
      >;
    }) as typeof Bun.serve;

    const settled = serveRealtime({
      resources,
      port: 0,
      sink: () => {},
      serve: fakeServe,
    });

    await Promise.resolve();
    const beforeEitherResolves = serveCalled;

    listenGate.resolve({ unlisten: async () => {} });
    await Promise.resolve();
    await Promise.resolve();
    const afterListenOnly = serveCalled;

    highWaterMarkGate.resolve(OUTBOX_ORIGIN);
    await settled;
    const afterBoth = serveCalled;

    assert({
      given:
        'a database whose listenOutbox and readOutboxHighWaterMark are deferred independently',
      should:
        'call serve() only once both have resolved, never before either one',
      actual: { beforeEitherResolves, afterListenOnly, afterBoth },
      expected: {
        beforeEitherResolves: false,
        afterListenOnly: false,
        afterBoth: true,
      },
    });
  });
});
