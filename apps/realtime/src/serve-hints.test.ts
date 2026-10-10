import { assert, setupRitewayBun, test } from 'riteway/bun';
import { OUTBOX_ORIGIN } from '@daisy/db';
import { serveRealtime } from './serve';
import { fakeApp } from './serve.test-support';
import { deferred } from './outbox-drain.test-support';

setupRitewayBun();
const timers = {
  setInterval: () => 0 as unknown as ReturnType<typeof setInterval>,
  clearInterval: () => {},
};

test('native server waits for the existing-pool transient LISTEN acknowledgement', async () => {
  const gate = deferred<{ unlisten: () => Promise<void> }>();
  const began = deferred<void>();
  let served = 0;
  let stopped = 0;
  const opening = serveRealtime({
    port: 0,
    timers,
    resources: fakeApp({
      listenOutbox: async () => ({ unlisten: async () => {} }),
      readOutboxHighWaterMark: async () => OUTBOX_ORIGIN,
      listenRealtimeHints: async () => {
        began.resolve();
        return gate.promise;
      },
    }),
    serve: (() => {
      served += 1;
      return { stop: async () => {} };
    }) as unknown as typeof Bun.serve,
  });
  await began.promise;
  const before = served;
  gate.resolve({
    unlisten: async () => {
      stopped += 1;
    },
  });
  const runtime = await opening;
  await runtime.close();
  await runtime.close();
  assert({
    given: 'an acknowledged durable drain and pending transient listener',
    should:
      'serve only after both resources are ready and close the listener once',
    actual: { before, served, stopped },
    expected: { before: 0, served: 1, stopped: 1 },
  });
});

for (const failure of ['hint-listen', 'serve', 'shutdown'] as const)
  test(`transient lifecycle releases owned resources when ${failure} fails`, async () => {
    const released: string[] = [];
    let refused = false;
    try {
      const runtime = await serveRealtime({
        port: 0,
        timers,
        resources: fakeApp({
          listenOutbox: async () => ({
            unlisten: async () => {
              released.push('outbox');
            },
          }),
          readOutboxHighWaterMark: async () => OUTBOX_ORIGIN,
          listenRealtimeHints: async () => {
            if (failure === 'hint-listen')
              throw new Error('Fixture LISTEN refusal');
            return {
              unlisten: async () => {
                released.push('hints');
              },
            };
          },
        }),
        serve: (() => {
          if (failure === 'serve') throw new Error('Fixture serve refusal');
          return {
            stop: async () => {
              throw new Error('Fixture shutdown refusal');
            },
          };
        }) as unknown as typeof Bun.serve,
      });
      await runtime.close();
    } catch {
      refused = true;
    }
    assert({
      given: `${failure} refusal at an owned transport lifecycle boundary`,
      should: 'report refusal and still release all acknowledged listeners',
      actual: { refused, released: released.sort() },
      expected: {
        refused: true,
        released: failure === 'hint-listen' ? ['outbox'] : ['hints', 'outbox'],
      },
    });
  });
