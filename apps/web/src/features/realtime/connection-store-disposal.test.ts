import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createConnectionStore } from './connection-store';
import {
  FakeSocket,
  createTimerQueue,
  flush,
} from './connection-store.test-support';

setupRitewayBun();

test('final disposal releases listeners and fences tickets irreversibly', async () => {
  const listeners = new Set<(visible: boolean) => void>();
  const sockets: FakeSocket[] = [];
  let resolveTicket!: (ticket: string) => void;
  const store = createConnectionStore({
    url: 'wss://realtime.test/ws',
    scheduler: createTimerQueue((clock, ms) => clock + ms),
    random: () => 0.5,
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    fetchTicket: () =>
      new Promise<string>((resolve) => {
        resolveTicket = resolve;
      }),
    onVisibilityChange: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  });
  store.connect();
  sockets[0]!.open();
  store.dispose();
  store.dispose();
  resolveTicket('a'.repeat(43));
  await flush();
  store.connect();
  assert({
    given: 'a pending ticket and repeated final disposal',
    should: 'release external listeners, reject late work and never reconnect',
    actual: {
      listeners: listeners.size,
      sockets: sockets.length,
      frames: sockets[0]!.sent.length,
    },
    expected: { listeners: 0, sockets: 1, frames: 0 },
  });
});

test('final disposal aborts outstanding ticket network work', () => {
  let signal: AbortSignal | undefined;
  const store = createConnectionStore({
    url: 'wss://realtime.test/ws',
    scheduler: createTimerQueue((clock, ms) => clock + ms),
    random: () => 0.5,
    createSocket: () => new FakeSocket(),
    fetchTicket: async (active) => {
      signal = active;
      return new Promise<string>(() => {});
    },
    onVisibilityChange: () => () => {},
  });
  store.connect();
  store.dispose();
  assert({
    given: 'an outstanding ticket fetch',
    should: 'abort owned network work during final disposal',
    actual: signal?.aborted,
    expected: true,
  });
});
