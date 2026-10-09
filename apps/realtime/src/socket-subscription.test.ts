import type { ServerWebSocket } from 'bun';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { Logger } from '@daisy/logger';
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
