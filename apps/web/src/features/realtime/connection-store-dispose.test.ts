import { assert, setupRitewayBun, test } from 'riteway/bun';
import { ENVELOPE_VERSION } from '@daisy/protocol';
import { buildChannelTopic } from '@daisy/protocol';
import {
  createConnectionStore,
  type ConnectionStoreDeps,
} from './connection-store';
import {
  createTimerQueue,
  FakeSocket,
  flush,
  validTicket,
} from './connection-store.test-support';
import { onDocumentVisibilityChange } from './browser-adapters';

setupRitewayBun();

/** A visibility source that counts the listeners it still holds. */
function liveVisibility() {
  const handlers = new Set<(visible: boolean) => void>();
  return {
    held: () => handlers.size,
    onVisibilityChange: (handler: (visible: boolean) => void) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };
}

function deps(
  visibility: ReturnType<typeof liveVisibility>,
  scheduler: ReturnType<typeof createTimerQueue>,
  sockets: FakeSocket[],
  fetchTicket: (signal: AbortSignal) => Promise<string> = async () =>
    validTicket,
): ConnectionStoreDeps {
  return {
    url: 'wss://realtime.test/ws',
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    scheduler,
    fetchTicket,
    random: () => 0.5,
    onVisibilityChange: visibility.onVisibilityChange,
  };
}

test('100 create, connect and dispose cycles return to the baseline', async () => {
  const visibility = liveVisibility();
  const scheduler = createTimerQueue((clock, ms) => clock + ms);
  const sockets: FakeSocket[] = [];
  let stateListeners = 0;
  for (let cycle = 0; cycle < 100; cycle += 1) {
    const store = createConnectionStore(deps(visibility, scheduler, sockets));
    store.subscribe(() => {
      stateListeners += 1;
    });
    store.subscribeTopic(buildChannelTopic('c'.repeat(24)), () => {});
    store.connect();
    sockets.at(-1)!.open();
    await flush();
    sockets.at(-1)!.message({ v: ENVELOPE_VERSION, type: 'ready' });
    store.dispose();
    store.dispose();
  }
  const notifiedBefore = stateListeners;
  scheduler.advance(10 * 60_000);
  assert({
    given: '100 stores each connected, subscribed and disposed twice',
    should:
      'hold no visibility listener or timer, close every socket, and notify nobody afterwards',
    actual: {
      visibilityListeners: visibility.held(),
      timers: scheduler.pending(),
      openSockets: sockets.filter((socket) => socket.closedWith === null)
        .length,
      socketsCreated: sockets.length,
      notifiedAfter: stateListeners - notifiedBefore,
    },
    expected: {
      visibilityListeners: 0,
      timers: 0,
      openSockets: 0,
      socketsCreated: 100,
      notifiedAfter: 0,
    },
  });
});

test('a ticket answered after disposal cannot open, send or schedule', async () => {
  const visibility = liveVisibility();
  const scheduler = createTimerQueue((clock, ms) => clock + ms);
  const sockets: FakeSocket[] = [];
  const ticket = Promise.withResolvers<string>();
  let ticketSignal: AbortSignal | undefined;
  const store = createConnectionStore(
    deps(visibility, scheduler, sockets, (signal) => {
      ticketSignal = signal;
      return ticket.promise;
    }),
  );
  store.connect();
  sockets[0]!.open();
  store.dispose();
  ticket.resolve(validTicket);
  await flush();
  sockets[0]!.message({ v: ENVELOPE_VERSION, type: 'ready' });
  store.connect();
  let notified = 0;
  store.subscribe(() => (notified += 1));
  store.onMessage(() => (notified += 1));
  store.onDiagnostic(() => (notified += 1));
  store.subscribeTopic('debate:' + 'd'.repeat(24), () => (notified += 1));
  store.close();
  assert({
    given:
      'a disposed store whose ticket and socket answer late, then new registrations',
    should:
      'abort the ticket fetch, send nothing, schedule nothing, refuse to connect and retain no listener',
    actual: {
      aborted: ticketSignal?.aborted,
      sent: sockets[0]!.sent.length,
      timers: scheduler.pending(),
      sockets: sockets.length,
      status: store.getState().status,
      notified,
    },
    expected: {
      aborted: true,
      sent: 0,
      timers: 0,
      sockets: 1,
      status: 'closed',
      notified: 0,
    },
  });
});

test('a deliberate close stays reusable', async () => {
  const visibility = liveVisibility();
  const scheduler = createTimerQueue((clock, ms) => clock + ms);
  const sockets: FakeSocket[] = [];
  const store = createConnectionStore(deps(visibility, scheduler, sockets));
  store.connect();
  store.close();
  store.connect();
  assert({
    given: 'close then connect',
    should: 'open a new socket and keep the visibility listener',
    actual: {
      sockets: sockets.length,
      status: store.getState().status,
      listeners: visibility.held(),
    },
    expected: { sockets: 2, status: 'connecting', listeners: 1 },
  });
  store.dispose();
});

test('the browser visibility adapter removes its document listener', () => {
  const target = Object.assign(new EventTarget(), {
    visibilityState: 'visible' as DocumentVisibilityState,
  });
  let held = 0;
  const add = target.addEventListener.bind(target);
  const remove = target.removeEventListener.bind(target);
  target.addEventListener = (...args: Parameters<typeof add>) => {
    held += 1;
    add(...args);
  };
  target.removeEventListener = (...args: Parameters<typeof remove>) => {
    held -= 1;
    remove(...args);
  };
  const seen: boolean[] = [];
  const stop = onDocumentVisibilityChange(
    (visible) => seen.push(visible),
    target,
  );
  target.dispatchEvent(new Event('visibilitychange'));
  stop();
  target.dispatchEvent(new Event('visibilitychange'));
  assert({
    given: 'a real event target standing in for the document',
    should: 'deliver while attached and hold no listener after release',
    actual: { seen, held },
    expected: { seen: [true], held: 0 },
  });
});
