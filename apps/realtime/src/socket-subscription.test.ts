import type { ServerWebSocket } from 'bun';
import { expect } from 'bun:test';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { Logger } from '@daisy/logger';
import { closeFor } from './handlers/hello';
import {
  createWebSocketHandlers,
  type SocketData,
  type SocketTimers,
} from './socket';
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
  registry = fixture().registry,
  timers: SocketTimers = {
    setTimeout: () => 1 as unknown as ReturnType<typeof setTimeout>,
    clearTimeout: () => {},
  },
  logged: unknown[] = [],
) => {
  const logger = {
    log: (_event: string, fields: unknown) => logged.push(fields),
    child: () => logger,
  } as unknown as Logger;
  return createWebSocketHandlers({
    logger,
    registry,
    now: () => 0,
    timers,
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
    should: 'close as a slow server, without the rate limit backoff',
    actual: over.closes,
    expected: [closeFor('slow_consumer').code],
  });

  const thrown = orderedSocket();
  const reported: string[] = [];
  const { registry } = fixture();
  const subscribe = registry.subscribe.bind(registry);
  let calls = 0;
  registry.subscribe = (...args) => {
    calls += 1;
    return calls === 1
      ? Promise.reject(new Error('subscribe crashed'))
      : subscribe(...args);
  };
  const survivor = orderedHandlers(
    async () => true,
    (_, operation) => reported.push(operation),
    registry,
  );
  survivor.open(thrown.ws);
  await survivor.message(thrown.ws, hello);
  await survivor.message(thrown.ws, frameOf('subscribe', 'd'));
  await survivor.message(thrown.ws, frameOf('subscribe', 'e'));
  assert({
    given: 'a frame whose effect throws, and a frame behind it',
    should: 'report the first and let the next take effect',
    actual: {
      reported,
      last: JSON.parse(thrown.frames.at(-1)!).id,
      closes: thrown.closes,
    },
    expected: {
      reported: ['realtime.frame'],
      last: 'e'.repeat(24),
      closes: [],
    },
  });
});

test('a ping answers at once behind a held turn, from its own check', async () => {
  const { ws, frames } = orderedSocket();
  const { held, check } = heldChecks();
  const handlers = orderedHandlers(check);
  handlers.open(ws);
  await handlers.message(ws, hello);
  void handlers.message(ws, frameOf('subscribe', 'd'));
  await flush();
  const ping = handlers.message(
    ws,
    JSON.stringify({ v: 1, type: 'ping', id: 'p'.repeat(24) }),
  );
  await flush();
  held[1]?.(true);
  await ping;
  assert({
    given: 'a subscribe held on its principal check, then a ping',
    should: 'answer the ping after its own check, ahead of the held turn',
    actual: {
      checks: held.length,
      last: JSON.parse(frames.at(-1)!).type,
    },
    expected: { checks: 2, last: 'pong' },
  });
  held[0]?.(false);
});

test('a reporter that throws leaves the queue working', async () => {
  const { ws, frames, closes } = orderedSocket();
  const { registry } = fixture();
  const subscribe = registry.subscribe.bind(registry);
  let calls = 0;
  registry.subscribe = (...args) => {
    calls += 1;
    return calls === 1
      ? Promise.reject(new Error('subscribe crashed'))
      : subscribe(...args);
  };
  const handlers = orderedHandlers(
    async () => true,
    () => {
      throw new Error('reporter crashed');
    },
    registry,
  );
  handlers.open(ws);
  await handlers.message(ws, hello);
  await handlers.message(ws, frameOf('subscribe', 'd'));
  await handlers.message(ws, frameOf('subscribe', 'e'));
  assert({
    given: 'a frame that throws and a reporter that also throws',
    should: 'still let the next frame take effect',
    actual: { last: JSON.parse(frames.at(-1)!).id, closes },
    expected: { last: 'e'.repeat(24), closes: [] },
  });
});

test('a stalled turn closes the socket so the client reconnects', async () => {
  const { ws, closes } = orderedSocket();
  const { check } = heldChecks();
  const scheduled: Array<{ callback: () => void; ms: number }> = [];
  const logged: unknown[] = [];
  const handlers = orderedHandlers(
    check,
    undefined,
    fixture().registry,
    {
      setTimeout: (callback, ms) => {
        scheduled.push({ callback, ms });
        return scheduled.length as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimeout: () => {},
    },
    logged,
  );
  handlers.open(ws);
  await handlers.message(ws, hello);
  void handlers.message(ws, frameOf('subscribe', 'd'));
  await flush();
  const budget = scheduled.at(-1)!;
  budget.callback();
  assert({
    given: 'a turn that never settles, with pings still answering around it',
    should: 'close on its budget, inside the 30 s the client allows',
    actual: {
      insideHeartbeat: budget.ms < 30_000,
      closes,
      cause: (logged.at(-1) as { cause?: string }).cause,
    },
    expected: {
      insideHeartbeat: true,
      closes: [closeFor('authority_unavailable').code],
      cause: 'turn_stalled',
    },
  });
});

test('a turn that finishes clears its budget', async () => {
  const { ws, closes } = orderedSocket();
  const scheduled: Array<{ handle: number; ms: number }> = [];
  const cleared: unknown[] = [];
  const handlers = orderedHandlers(
    async () => true,
    undefined,
    fixture().registry,
    {
      setTimeout: (_, ms) => {
        scheduled.push({ handle: scheduled.length + 1, ms });
        return scheduled.length as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimeout: (handle) => cleared.push(handle),
    },
  );
  handlers.open(ws);
  await handlers.message(ws, hello);
  await handlers.message(ws, frameOf('subscribe', 'd'));
  const budget = scheduled.at(-1)!;
  assert({
    given: 'a frame that takes effect within its budget',
    should: 'clear that budget, so an idle socket is never closed by it',
    actual: {
      budget: budget.ms,
      cleared: cleared.includes(budget.handle),
      closes,
    },
    expected: { budget: 15_000, cleared: true, closes: [] },
  });
});
