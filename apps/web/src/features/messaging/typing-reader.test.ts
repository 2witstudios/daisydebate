import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { ConnectionState } from '../realtime/connection-types';
import { createTimerQueue } from '../realtime/connection-store.test-support';
import { attachTypingReader } from './typing-reader';
setupRitewayBun();
test('reconnect discards the earlier typing HTTP result and coalesces a fresh read', async () => {
  const timers = createTimerQueue((now, ms) => now + ms);
  const first = Promise.withResolvers<Response>();
  const second = Promise.withResolvers<Response>();
  const refreshed = Promise.withResolvers<void>();
  const values: (boolean | null)[] = [];
  let calls = 0,
    released = 0;
  let state: (value: ConnectionState) => void = () => {};
  const reader = attachTypingReader({
    channelId: 'c'.repeat(24),
    recoveryAfterMs: 600,
    timers,
    read: () => (++calls === 1 ? first.promise : second.promise),
    connection: {
      subscribeTopic: () => () => {
        released++;
      },
      subscribe: (listener) => {
        state = listener;
        return () => {
          released++;
        };
      },
    },
    publish: (value) => {
      values.push(value);
      if (value === false) refreshed.resolve();
    },
  });
  state({ status: 'connecting', generation: 2, terminal: null });
  state({ status: 'closed', generation: 2, terminal: null });
  state({ status: 'open', generation: 3, terminal: null });
  first.resolve(
    Response.json({
      version: 1,
      channelId: 'c'.repeat(24),
      typing: true,
      refreshAfterMs: 500,
    }),
  );
  second.resolve(
    Response.json({
      version: 1,
      channelId: 'c'.repeat(24),
      typing: false,
      refreshAfterMs: 300,
    }),
  );
  await refreshed.promise;
  reader.close();
  timers.advance(1000);
  state({ status: 'open', generation: 4, terminal: null });
  assert({
    given: 'a pending pre-reconnect response and several socket state changes',
    should:
      'publish only the fresh projection, coalesce HTTP work and release both listeners without a later retry',
    actual: [calls, values.includes(true), values.at(-1), released],
    expected: [2, false, null, 2],
  });
});
