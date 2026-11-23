import type { ServerWebSocket } from 'bun';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { Logger } from '@daisy/logger';
import {
  createWebSocketHandlers,
  HELLO_TIMEOUT_MS,
  type SocketData,
} from './socket';
import { recordingWaits } from './socket.test-support';

setupRitewayBun();

const fakeLogger = (): { logger: Logger; calls: unknown[][] } => {
  const calls: unknown[][] = [];
  const logger: Logger = {
    log: (...args) => {
      calls.push(args);
    },
    child: () => logger,
  };
  return { logger, calls };
};

const fakeSocket = (): {
  ws: ServerWebSocket<SocketData>;
  closes: { code: number; reason: string }[];
} => {
  const closes: { code: number; reason: string }[] = [];
  const ws = {
    data: {} as SocketData,
    close: (code: number, reason: string) => {
      closes.push({ code, reason });
    },
  } as unknown as ServerWebSocket<SocketData>;
  return { ws, closes };
};

describe('createWebSocketHandlers', () => {
  test('valid hello consumes the ticket before ready, and late allow after deadline cannot resurrect', async () => {
    const { waits, clock } = recordingWaits();
    const { logger } = fakeLogger();
    const { ws, closes } = fakeSocket();
    const sent: string[] = [];
    ws.send = (frame) => {
      sent.push(String(frame));
      return 1;
    };
    ws.data.origin = 'http://localhost:3000';
    let allow!: (
      value: { actorId: string; userId: string; sessionId: string } | null,
    ) => void;
    const handlers = createWebSocketHandlers({
      logger,
      waits,
      authenticate: () =>
        new Promise((resolve) => {
          allow = resolve;
        }),
    });
    handlers.open(ws);
    const pending = handlers.message(
      ws,
      JSON.stringify({
        v: 1,
        type: 'hello',
        protocolVersion: 1,
        ticket: 'a'.repeat(43),
      }),
    );
    await clock.advance(HELLO_TIMEOUT_MS);
    allow({
      actorId: 'a'.repeat(24),
      userId: 'b'.repeat(24),
      sessionId: 'c'.repeat(24),
    });
    await pending;
    assert({
      given: 'authentication resolving after the hello deadline',
      should: 'close retryably, as the hello was in time, and never send ready',
      actual: { closes, sent },
      expected: {
        closes: [{ code: 4007, reason: 'authority_unavailable' }],
        sent: [],
      },
    });
  });
  test('arms a 5s hello deadline on open', () => {
    const { waits, scheduled } = recordingWaits();
    const { logger } = fakeLogger();
    const { ws } = fakeSocket();
    const handlers = createWebSocketHandlers({ logger, waits });

    handlers.open(ws);

    assert({
      given: 'a newly opened socket',
      should: 'schedule the hello deadline at HELLO_TIMEOUT_MS',
      actual: scheduled,
      expected: [HELLO_TIMEOUT_MS],
    });
  });

  test('closes 4001 auth_failed and logs the rejection when the hello deadline fires', async () => {
    const { waits, clock } = recordingWaits();
    const { logger, calls } = fakeLogger();
    const { ws, closes } = fakeSocket();
    const handlers = createWebSocketHandlers({ logger, waits });

    handlers.open(ws);
    await clock.advance(HELLO_TIMEOUT_MS - 1);
    const closedEarly = closes.length;
    await clock.advance(1);

    assert({
      given: 'no message arriving before the hello deadline',
      should: 'close 4001 auth_failed and log it with cause hello_timeout',
      actual: {
        closedEarly,
        closes,
        loggedEvent: calls[0]?.[0],
        loggedFields: calls[0]?.[1],
      },
      expected: {
        closedEarly: 0,
        closes: [{ code: 4001, reason: 'auth_failed' }],
        loggedEvent: 'realtime.connection.rejected',
        loggedFields: {
          closeCode: 4001,
          closeReason: 'auth_failed',
          cause: 'hello_timeout',
        },
      },
    });
  });

  test('clears the hello timer and closes per the parsed outcome on message', () => {
    const { waits, cleared } = recordingWaits();
    const { logger, calls } = fakeLogger();
    const { ws, closes } = fakeSocket();
    const handlers = createWebSocketHandlers({ logger, waits });

    handlers.open(ws);
    handlers.message(ws, 'not json');

    assert({
      given: 'a first message that fails to parse',
      should:
        'clear the hello timer, close 4003 and log the rejection with cause message_rejected',
      actual: {
        timerCleared: cleared(),
        closes,
        loggedEvent: calls[0]?.[0],
        loggedFields: calls[0]?.[1],
      },
      expected: {
        timerCleared: 1,
        closes: [{ code: 4003, reason: 'protocol_unsupported' }],
        loggedEvent: 'realtime.connection.rejected',
        loggedFields: {
          closeCode: 4003,
          closeReason: 'protocol_unsupported',
          cause: 'message_rejected',
        },
      },
    });
  });

  test('clears the hello timer on close without a pending timer', () => {
    const { waits, cleared } = recordingWaits();
    const { logger } = fakeLogger();
    const { ws } = fakeSocket();
    const handlers = createWebSocketHandlers({ logger, waits });

    handlers.close(ws);

    assert({
      given: 'a socket that closes with no timer ever armed',
      should: 'never cancel a deadline',
      actual: cleared(),
      expected: 0,
    });
  });
});
