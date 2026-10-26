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

const connect = async () => {
  const events: unknown[][] = [];
  const presence: PresenceTracker = {
    start: (actor) => {
      events.push(['start', actor]);
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
  });
  handlers.open(ws);
  await handlers.message(ws, hello);
  return { ws, handlers, events };
};

test('an authenticated socket holds one presence session', async () => {
  const { ws, handlers, events } = await connect();
  await handlers.message(
    ws,
    JSON.stringify({ v: 1, type: 'presence.activity', activity: 'idle' }),
  );
  handlers.close(ws);
  assert({
    given: 'a hello, an idle report and a clean close',
    should: 'start presence for the actor, report idle, then stop it',
    actual: events,
    expected: [['start', actorId], ['activity', 'idle'], ['stop']],
  });
});

test('a rejected socket stops its presence session', async () => {
  const { ws, handlers, events } = await connect();
  await handlers.message(ws, 'not json');
  assert({
    given: 'an authenticated socket sending an unparseable frame',
    should: 'stop presence as it closes',
    actual: events,
    expected: [['start', actorId], ['stop']],
  });
});
