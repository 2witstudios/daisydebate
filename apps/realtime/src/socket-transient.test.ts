import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { ServerWebSocket } from 'bun';
import {
  createWebSocketHandlers,
  HELLO_TIMEOUT_MS,
  type SocketData,
} from './socket';

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
  const reported: unknown[] = [];
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
    failed: (_error, operation) => reported.push(operation),
    ...checks,
  });
  handlers.open(ws);
  await handlers.message(ws, hello);
  if (closes.length === 0) await handlers.message(ws, ping);
  return { closes, reported };
}
const failure = () => Promise.reject(new Error('private adapter failure'));

test('a hello or frame check that cannot answer closes retryably; a definite answer does not', async () => {
  assert({
    given: 'each check failing, then answering no',
    should: 'close 4007 and report the failure only when nothing was decided',
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
      helloFailed: { closes: [4007], reported: ['realtime.hello'] },
      helloDenied: { closes: [4001], reported: [] },
      frameFailed: { closes: [4007], reported: ['realtime.frame'] },
      frameDenied: { closes: [4002], reported: [] },
    },
  });
});

test('a check answering after the hello deadline, before its timer fires, closes retryably', async () => {
  const closes: number[] = [];
  const sent: unknown[] = [];
  const rejections: unknown[] = [];
  let elapsed = 0;
  const ws = {
    data: { origin: 'https://app.example.test' } as SocketData,
    send: (frame: unknown) => sent.push(frame),
    getBufferedAmount: () => 0,
    close: (code: number) => closes.push(code),
    subscribe: () => true,
    unsubscribe: () => {},
  } as unknown as ServerWebSocket<SocketData>;
  const handlers = createWebSocketHandlers({
    logger: {
      log: (_event: string, fields: { cause?: unknown }) =>
        rejections.push(fields.cause),
    } as unknown as typeof logger,
    timers: {
      setTimeout: () => 1 as unknown as ReturnType<typeof setTimeout>,
      clearTimeout: () => {},
    },
    now: () => elapsed,
    authenticate: async () => {
      elapsed = HELLO_TIMEOUT_MS;
      return principal;
    },
  });
  handlers.open(ws);
  await handlers.message(ws, hello);
  assert({
    given: 'a hello in time whose check answers past the deadline',
    should: 'close 4007 as a hello timeout and never send ready',
    actual: { closes, sent, rejections },
    expected: { closes: [4007], sent: [], rejections: ['hello_timeout'] },
  });
});
