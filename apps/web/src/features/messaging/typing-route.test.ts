import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAppError } from '@daisy/errors';
import { silentLogger } from '../../server/test-loggers.test-support';
import { createMessagingTypingHandler } from './typing-route';
import { readTypingResponse } from './typing-response';
setupRitewayBun();
test('typing HTTP admits only current identified boolean intent and strict own-channel responses', async () => {
  const channelId = 'c'.repeat(24),
    userId = 'u'.repeat(24),
    actorId = 'a'.repeat(24);
  const calls: unknown[] = [],
    statuses: number[] = [];
  const origin = 'https://daisy.example',
    result = {
      version: 1 as const,
      channelId,
      typing: false,
      refreshAfterMs: 500,
    };
  const handler = createMessagingTypingHandler({
    maxBodyBytes: 256,
    boundary: {
      logger: silentLogger,
      origin: () => origin,
      identify: async () => ({
        state: 'member',
        username: 'member',
        principal: { kind: 'user', actorId, userId },
      }),
    },
    consume: async () => {
      if (statuses.length === 4) throw createAppError('RATE_LIMIT');
    },
    store: (principal) => ({
      read: async (id) => {
        calls.push([principal, id]);
        return result;
      },
      update: async (id, typing) => {
        calls.push([principal, id, typing]);
        return result;
      },
    }),
  });
  const request = (body: unknown, source = origin) =>
    new Request(`${origin}/typing`, {
      method: 'POST',
      headers: { origin: source, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  for (const [body, source] of [
    [{ version: 1, channelId, typing: true }, origin],
    [{ version: 1, channelId, typing: false, text: 'private draft' }, origin],
    [{ version: 1, channelId, typing: true }, 'https://foreign.example'],
  ] as const)
    statuses.push((await handler(request(body, source), true)).status);
  statuses.push(
    (
      await handler(
        new Request(`${origin}/typing?actorId=${actorId}`),
        false,
        channelId,
      )
    ).status,
  );
  statuses.push(
    (await handler(request({ version: 1, channelId, typing: true }), true))
      .status,
  );
  const read = await handler(new Request(`${origin}/typing`), false, channelId);
  assert({
    given:
      'strict write/read, extra private content, foreign origin, query injection and actual limiter refusal',
    should: 'dispatch only accepted own-channel calls',
    actual: [statuses, read.status, calls],
    expected: [
      [200, 400, 403, 400, 429],
      200,
      [
        [{ kind: 'user', actorId, userId }, channelId, true],
        [{ kind: 'user', actorId, userId }, channelId],
      ],
    ],
  });
  const accepted = await readTypingResponse(channelId, Promise.resolve(read));
  const refused = await Promise.all([
    readTypingResponse('x'.repeat(24), Promise.resolve(Response.json(result))),
    readTypingResponse(
      channelId,
      Promise.resolve(Response.json({ ...result, actorId })),
    ),
    readTypingResponse(channelId, Promise.resolve(new Response('bad json'))),
    readTypingResponse(
      channelId,
      Promise.resolve(new Response(null, { status: 503 })),
    ),
    readTypingResponse(
      channelId,
      Promise.reject(new Error('Unavailable transport')),
    ),
  ]);
  assert({
    given:
      'actual strict browser parser with valid/foreign/malformed/unavailable response',
    should:
      'accept only the own aggregate and expose no exception or stale typing',
    actual: [accepted, refused],
    expected: [result, [null, null, null, null, null]],
  });
});
