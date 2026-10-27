import type { ServerWebSocket } from 'bun';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { Logger } from '@daisy/logger';
import { createWebSocketHandlers, type SocketData } from './socket';
import type { PresenceTracker } from './presence';

setupRitewayBun();

const logger: Logger = { log: () => {}, child: () => logger };
const actorId = 'a'.repeat(24);
const hello = JSON.stringify({
  v: 1,
  type: 'hello',
  protocolVersion: 1,
  ticket: 'a'.repeat(43),
});

const connect = async ({
  valid = async () => true,
  registry,
}: {
  readonly valid?: () => Promise<boolean>;
  readonly registry?: Parameters<typeof createWebSocketHandlers>[0]['registry'];
} = {}) => {
  const events: unknown[][] = [];
  const presence: PresenceTracker = {
    start: (actor, activity) => {
      events.push(['start', actor, activity]);
      return {
        activity: (activity) => events.push(['activity', activity]),
        stop: () => events.push(['stop']),
      };
    },
  };
  const ws = {
    data: { origin: 'http://localhost:3000' } as SocketData,
    send: () => 1,
    getBufferedAmount: () => 0,
    close: () => {},
  } as unknown as ServerWebSocket<SocketData>;
  const handlers = createWebSocketHandlers({
    logger,
    timers: { setTimeout: () => 0 as never, clearTimeout: () => {} },
    now: () => 0,
    authenticate: async () => ({
      actorId,
      userId: 'b'.repeat(24),
      sessionId: 'c'.repeat(24),
    }),
    presence,
    validatePrincipal: valid,
    ...(registry ? { registry } : {}),
  });
  handlers.open(ws);
  await handlers.message(ws, hello);
  return { ws, handlers, events };
};

const activity = (value: 'active' | 'idle') =>
  JSON.stringify({ v: 1, type: 'presence.activity', activity: value });

test('only a socket that reports activity holds a presence session', async () => {
  const quiet = await connect();
  quiet.handlers.close(quiet.ws);
  const reporting = await connect();
  await reporting.handlers.message(reporting.ws, activity('active'));
  await reporting.handlers.message(reporting.ws, activity('idle'));
  reporting.handlers.close(reporting.ws);
  assert({
    given:
      'a room or conversation socket that never reports, and a shell socket that reports active then idle',
    should:
      'hold no lease for the first, and start, update and stop one for the second',
    actual: [quiet.events, reporting.events],
    expected: [
      [],
      [['start', actorId, 'active'], ['activity', 'idle'], ['stop']],
    ],
  });
});

test('a rejected socket stops its presence session', async () => {
  const { ws, handlers, events } = await connect();
  await handlers.message(ws, activity('idle'));
  await handlers.message(ws, 'not json');
  assert({
    given: 'a reporting socket sending an unparseable frame',
    should: 'stop presence as it closes',
    actual: events,
    expected: [['start', actorId, 'idle'], ['stop']],
  });
});

test('a socket revoked on revalidation stops its presence session', async () => {
  let valid = true;
  const { ws, handlers, events } = await connect({
    valid: async () => valid,
  });
  await handlers.message(ws, activity('active'));
  valid = false;
  await handlers.message(ws, activity('idle'));
  assert({
    given: 'a reporting socket whose session is revoked before its next frame',
    should: 'stop presence as it closes, and never apply the late frame',
    actual: events,
    expected: [['start', actorId, 'active'], ['stop']],
  });
});

test('a socket the registry closes stops its presence session once', async () => {
  let closeFromRegistry: (() => void) | null = null;
  const registry = {
    add: (socket: { close: (code: number, reason: string) => void }) => {
      closeFromRegistry = () => socket.close(4005, 'revoked');
      return {} as never;
    },
    remove: () => {},
    subscribe: async () => {},
    unsubscribe: () => {},
  } as never;
  const { ws, handlers, events } = await connect({ registry });
  const closes: number[] = [];
  // As Bun does, closing the socket delivers its close event to the handler.
  ws.close = (code?: number) => {
    closes.push(code ?? 0);
    handlers.close(ws);
  };
  await handlers.message(ws, activity('active'));
  closeFromRegistry!();
  handlers.close(ws);
  assert({
    given: 'the registry closing a reporting socket, then a second close event',
    should: 'close the socket and stop presence exactly once',
    actual: [closes, events],
    expected: [[4005], [['start', actorId, 'active'], ['stop']]],
  });
});
