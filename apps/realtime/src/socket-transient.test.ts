import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { ServerWebSocket } from 'bun';
import { createWebSocketHandlers, type SocketData } from './socket';

setupRitewayBun();

const principal = {
  actorId: 'a'.repeat(24),
  userId: 'b'.repeat(24),
  sessionId: 'c'.repeat(24),
};
const hello = JSON.stringify({
  v: 1,
  type: 'hello',
  protocolVersion: 1,
  ticket: 'a'.repeat(43),
});
const ping = JSON.stringify({ v: 1, type: 'ping', id: 'p1' });
const logger = { log: () => {} } as unknown as Parameters<
  typeof createWebSocketHandlers
>[0]['logger'];

/** The close a socket's check ends in, for one answer from each check. */
async function closeAfter(
  checks: Pick<
    Parameters<typeof createWebSocketHandlers>[0],
    'authenticate' | 'validatePrincipal'
  >,
) {
  const closes: number[] = [];
  const ws = {
    data: { origin: 'https://app.example.test' } as SocketData,
    send: () => 1,
    getBufferedAmount: () => 0,
    close: (code: number) => closes.push(code),
    subscribe: () => true,
    unsubscribe: () => {},
  } as unknown as ServerWebSocket<SocketData>;
  const handlers = createWebSocketHandlers({
    logger,
    timers: {
      setTimeout: () => 1 as unknown as ReturnType<typeof setTimeout>,
      clearTimeout: () => {},
    },
    now: () => 0,
    ...checks,
  });
  handlers.open(ws);
  await handlers.message(ws, hello);
  if (closes.length === 0) await handlers.message(ws, ping);
  return closes;
}
const failure = () => Promise.reject(new Error('private adapter failure'));

test('a hello or frame check that cannot answer closes retryably; a definite answer does not', async () => {
  assert({
    given: 'each check failing, then answering no',
    should: 'close 4007 only when nothing was decided',
    actual: {
      helloFailed: await closeAfter({ authenticate: failure }),
      helloDenied: await closeAfter({ authenticate: async () => null }),
      frameFailed: await closeAfter({
        authenticate: async () => principal,
        validatePrincipal: failure,
      }),
      frameDenied: await closeAfter({
        authenticate: async () => principal,
        validatePrincipal: async () => false,
      }),
    },
    expected: {
      helloFailed: [4007],
      helloDenied: [4001],
      frameFailed: [4007],
      frameDenied: [4002],
    },
  });
});
