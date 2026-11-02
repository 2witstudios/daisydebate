import type { ServerWebSocket } from 'bun';
import { expect } from 'bun:test';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { Logger } from '@daisy/logger';
import { closeFor } from './handlers/hello';
import { createWebSocketHandlers, type SocketData } from './socket';
import { fixture, topic } from './registry.test-support';

setupRitewayBun();

for (const nativeAccepts of [true, false])
  test(`native subscription ${nativeAccepts ? 'acceptance' : 'refusal'} controls acknowledgement`, async () => {
    const { registry } = fixture();
    const frames: string[] = [];
    const closes: number[] = [];
    const logger = { log: () => {}, child: () => logger } as Logger;
    const ws = {
      data: { origin: 'https://realtime.integration.test' },
      send: (frame: string) => {
        frames.push(frame);
        return 1;
      },
      getBufferedAmount: () => 0,
      subscribe: () => nativeAccepts,
      unsubscribe: () => true,
      close: (code: number) => {
        closes.push(code);
      },
    } as unknown as ServerWebSocket<SocketData>;
    const handlers = createWebSocketHandlers({
      logger,
      registry,
      now: () => 0,
      timers: {
        setTimeout: () => 1 as unknown as ReturnType<typeof setTimeout>,
        clearTimeout: () => {},
      },
      authenticate: async () => ({
        actorId: 'a'.repeat(24),
        userId: 'b'.repeat(24),
        sessionId: 'c'.repeat(24),
      }),
      validatePrincipal: async () => true,
    });
    handlers.open(ws);
    await handlers.message(
      ws,
      JSON.stringify({
        v: 1,
        type: 'hello',
        protocolVersion: 1,
        ticket: 't'.repeat(43),
      }),
    );
    await handlers.message(
      ws,
      JSON.stringify({ v: 1, type: 'subscribe', id: 'd'.repeat(24), topic }),
    );
    assert({
      given: `the real handler adapter returning native subscribe=${nativeAccepts}`,
      should:
        'acknowledge only an attached subscription and otherwise close without an acknowledgement',
      actual: { types: frames.map((frame) => JSON.parse(frame).type), closes },
      expected: nativeAccepts
        ? { types: ['ready', 'subscribed'], closes: [] }
        : { types: ['ready'], closes: [4005] },
    });
  });

const orderedSocket = () => {
  const frames: string[] = [];
  const closes: number[] = [];
  const ws = {
    data: { origin: 'https://realtime.integration.test' },
    send: (frame: string) => {
      frames.push(frame);
      return 1;
    },
    getBufferedAmount: () => 0,
    subscribe: () => true,
    unsubscribe: () => true,
    close: (code: number) => {
      closes.push(code);
    },
  } as unknown as ServerWebSocket<SocketData>;
  return { ws, frames, closes };
};
const heldChecks = () => {
  const held: Array<(valid: boolean) => void> = [];
  return {
    held,
    check: () => new Promise<boolean>((resolve) => held.push(resolve)),
  };
};
const orderedHandlers = (
  validatePrincipal: () => Promise<boolean>,
  failed?: (error: unknown, operation: string) => void,
) => {
  const logger = { log: () => {}, child: () => logger } as Logger;
  return createWebSocketHandlers({
    logger,
    registry: fixture().registry,
    now: () => 0,
    timers: {
      setTimeout: () => 1 as unknown as ReturnType<typeof setTimeout>,
      clearTimeout: () => {},
    },
    authenticate: async () => ({
      actorId: 'a'.repeat(24),
      userId: 'b'.repeat(24),
      sessionId: 'c'.repeat(24),
    }),
    validatePrincipal,
    ...(failed ? { failed } : {}),
  });
};
const hello = JSON.stringify({
  v: 1,
  type: 'hello',
  protocolVersion: 1,
  ticket: 't'.repeat(43),
});
const frameOf = (type: 'subscribe' | 'unsubscribe', id: string) =>
  JSON.stringify({ v: 1, type, id: id.repeat(24), topic });
const flush = async () => {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
};

test('frames on one socket take effect in arrival order (ISSUE-1018)', async () => {
  const { ws, frames } = orderedSocket();
  const { held, check } = heldChecks();
  const handlers = orderedHandlers(check);
  handlers.open(ws);
  await handlers.message(ws, hello);
  const first = handlers.message(ws, frameOf('subscribe', 'd'));
  await flush();
  const unsubscribe = handlers.message(ws, frameOf('unsubscribe', 'e'));
  const subscribe = handlers.message(ws, frameOf('subscribe', 'f'));
  await flush();
  assert({
    given: 'a first principal check held back with two more frames behind it',
    should: 'start no later check until the first takes effect',
    actual: held.length,
    expected: 1,
  });
  for (let turn = 0; turn < 3; turn += 1) {
    held[turn]?.(true);
    await flush();
  }
  await Promise.all([first, unsubscribe, subscribe]);
  assert({
    given: 'an effect-cleanup unsubscribe then subscribe on the same topic',
    should: 'leave the later subscribe in force and acknowledge it last',
    actual: frames.map((frame) => JSON.parse(frame)).at(-1),
    expected: {
      v: 1,
      type: 'subscribed',
      id: 'f'.repeat(24),
      topic,
      position: expect.any(String),
    },
  });
});

test('the frame queue stays bounded and survives a frame that throws', async () => {
  const over = orderedSocket();
  const { check } = heldChecks();
  const handlers = orderedHandlers(check);
  handlers.open(over.ws);
  await handlers.message(over.ws, hello);
  for (let frame = 0; frame < 65; frame += 1)
    void handlers.message(over.ws, frameOf('unsubscribe', 'd'));
  assert({
    given: 'more frames than the queue holds behind a held check',
    should: 'close the socket as rate limited',
    actual: over.closes,
    expected: [closeFor('rate_limited').code],
  });

  const thrown = orderedSocket();
  const reported: string[] = [];
  let calls = 0;
  const survivor = orderedHandlers(
    async () => {
      calls += 1;
      if (calls === 1) throw new Error('check crashed');
      return true;
    },
    (_, operation) => reported.push(operation),
  );
  survivor.open(thrown.ws);
  await survivor.message(thrown.ws, hello);
  await survivor.message(thrown.ws, frameOf('subscribe', 'd'));
  assert({
    given: 'a check that throws',
    should: 'report it and fail closed, as a check that cannot answer does',
    actual: { reported, closed: thrown.closes.length },
    expected: { reported: ['realtime.frame'], closed: 1 },
  });
});
