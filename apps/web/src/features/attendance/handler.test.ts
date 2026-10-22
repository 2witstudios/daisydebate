import { assert, setupRitewayBun, test } from 'riteway/bun';
import { silentLogger } from '../../server/test-loggers.test-support';
import { createAttendanceHandler } from './handler';
import { createAppError } from '@daisy/errors';
setupRitewayBun();
const actorId = 'a'.repeat(24),
  roundId = 'b'.repeat(24),
  segmentId = 'c'.repeat(24),
  commandId = 'd'.repeat(24),
  origin = 'http://localhost:13140';
test('attendance HTTP rejects body authority and foreign ingress before its durable operation', async () => {
  let writes = 0;
  let unavailable = false;
  const handler = createAttendanceHandler({
    logger: silentLogger,
    origin: () => origin,
    active: () => true,
    identify: async () => ({
      state: 'member',
      username: 'Fixture',
      principal: { kind: 'user', userId: actorId, actorId },
    }),
    getActorByUserId: async () => ({ id: actorId }),
    limiter: () => ({
      consume: async () => ({ allowed: true, retryAfterSeconds: 0 }),
    }),
    checkIn: async () => {
      if (unavailable) throw createAppError('INFRASTRUCTURE');
      writes++;
      return {
        version: 1,
        commandId,
        roundId,
        segmentId,
        participantId: actorId,
        receivedAt: '2026-10-22T00:00:00.000001Z',
        resultingVersion: 1,
        replayed: false,
      };
    },
  });
  const statuses = [];
  for (const [suppliedOrigin, body] of [
    [origin, { version: 1, commandId, segmentId, actorId }],
    ['https://foreign.invalid', { version: 1, commandId, segmentId }],
  ] as const) {
    statuses.push(
      (
        await handler(
          new Request(`${origin}/api/rounds/${roundId}/check-in`, {
            method: 'POST',
            headers: {
              origin: suppliedOrigin,
              'content-type': 'application/json',
            },
            body: JSON.stringify(body),
          }),
          roundId,
        )
      ).status,
    );
  }
  assert({
    given: 'forged body actor or foreign origin',
    should: 'refuse before attendance writes',
    actual: { statuses, writes },
    expected: { statuses: [400, 403], writes: 0 },
  });
  const response = await handler(
    new Request(`${origin}/api/rounds/${roundId}/check-in`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ version: 1, commandId, segmentId }),
    }),
    roundId,
  );
  assert({
    given: 'canonical strict envelope and authenticated member',
    should: 'preserve actual PG receipt microseconds over HTTP',
    actual: {
      status: response.status,
      receivedAt: (await response.json()).receivedAt,
    },
    expected: { status: 200, receivedAt: '2026-10-22T00:00:00.000001Z' },
  });
  const native = (body: string) =>
    handler(
      new Request(`${origin}/api/rounds/${roundId}/check-in`, {
        method: 'POST',
        headers: {
          origin,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body,
      }),
      roundId,
    );
  const encoded = new URLSearchParams({
    version: '1',
    commandId,
    segmentId,
  }).toString();
  const recorded = await native(encoded);
  const refused = await native(`${encoded}&commandId=${commandId}`);
  unavailable = true;
  const pending = await native(encoded);
  assert({
    given:
      'explicit native POST, duplicate field and uncertain durable operation',
    should:
      'show truthful recorded/refused/pending feedback with a next action',
    actual: [
      recorded.status,
      (await recorded.text()).includes('Attendance recorded'),
      refused.status,
      pending.status,
      (await pending.text()).includes('Confirmation is pending'),
      writes,
    ],
    expected: [200, true, 400, 503, true, 2],
  });
});
