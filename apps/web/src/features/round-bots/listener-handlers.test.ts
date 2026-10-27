import { createAppError } from '@daisy/errors';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { silentLogger } from '../../server/test-loggers.test-support';
import { createBotListenerHandlers } from './listener-handlers';

setupRitewayBun();

const id = (c: string) => c.repeat(24);
const base = 'http://localhost/api/internal/media/r/bot-listener';

const fixture = (role = 'bot-listener') => {
  const calls: [string, unknown][] = [];
  const handlers = createBotListenerHandlers({
    logger: silentLogger,
    authentication: () =>
      ({
        verify: (signed: { signature: string }) => {
          if (signed.signature !== 'valid')
            throw createAppError('AUTHORIZATION');
          return { roundId: id('r'), workerId: id('w'), role };
        },
      }) as never,
    listener: () =>
      ({
        claimBotListenerLease: async (payload: unknown) => {
          calls.push(['lease', payload]);
          return { epoch: 1, expiresAt: '2026-10-27T12:00:15.000Z' };
        },
        readBotListenerState: async (payload: unknown) => {
          calls.push(['read', payload]);
          return { ok: 'read' };
        },
      }) as never,
    activity: async (identity, body) => {
      calls.push(['activity', { identity, body }]);
    },
  });
  return { handlers, calls };
};
const signed = (operation: string, body: string, signature = 'valid') =>
  new Request(`${base}/${operation}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-daisy-media-timestamp': '1',
      'x-daisy-media-signature': signature,
    },
    body,
  });
const scope = { sessionId: id('s'), workerId: id('w'), epoch: 2 };

test('signed listener activity separates the validated listener scope from its body (ISSUE-764)', async () => {
  const f = fixture();
  const response = await f.handlers.handle(
    signed('activity', JSON.stringify({ ...scope, frames: [] })),
  );
  assert({
    given: 'a signed activity batch from the bot listener',
    should:
      'relay the body apart from the scope bound to the verified Round, answering null',
    actual: [await response.json(), f.calls],
    expected: [
      null,
      [
        [
          'activity',
          { identity: { ...scope, roundId: id('r') }, body: { frames: [] } },
        ],
      ],
    ],
  });
});

test('the listener lease and read run under the verified Round', async () => {
  const f = fixture();
  await f.handlers.handle(
    signed('lease', JSON.stringify({ ...scope, leaseMs: 15000 })),
  );
  await f.handlers.handle(signed('read', JSON.stringify(scope)));
  assert({
    given: 'a signed lease claim and read',
    should: 'pass each to the listener operations with the signed Round',
    actual: f.calls.map(([name, payload]) => [
      name,
      (payload as { roundId: string }).roundId,
    ]),
    expected: [
      ['lease', id('r')],
      ['read', id('r')],
    ],
  });
});

test('capture, forged or unknown calls never reach the listener', async () => {
  const statuses = await Promise.all(
    [
      [fixture('capture'), signed('activity', JSON.stringify(scope))],
      [fixture(), signed('activity', JSON.stringify(scope), 'forged')],
      [fixture(), signed('append', JSON.stringify(scope))],
    ].map(async ([f, request]) => {
      const { handlers, calls } = f as ReturnType<typeof fixture>;
      const response = await handlers.handle(request as Request);
      return [response.status, calls.length];
    }),
  );
  assert({
    given:
      'a capture principal, a forged signature and an operation the listener does not own',
    should: 'refuse each without calling any listener operation',
    actual: statuses,
    expected: [
      [403, 0],
      [403, 0],
      [403, 0],
    ],
  });
});
