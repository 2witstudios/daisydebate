import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAppError } from '@daisy/errors';
import { attendanceMemberGates } from './member-gates.test-support';
import { createAttendanceHandler } from './handler';

setupRitewayBun();

test('attendance shares one member budget across unverified round ids', async () => {
  const origin = 'https://daisy.invalid';
  const uses = new Map<string, number>();
  let userId = 'a'.repeat(24);
  let lookups = 0;
  let writes = 0;
  let unavailable = false;
  const handler = createAttendanceHandler({
    ...attendanceMemberGates(origin, () => userId),
    getActorByUserId: async () => {
      lookups++;
      return { id: userId };
    },
    limiter: () => ({
      consume: async (key, rule) => {
        if (unavailable) throw new Error('Limiter unavailable');
        const count = (uses.get(key) ?? 0) + 1;
        uses.set(key, count);
        return { allowed: count <= rule.max, retryAfterSeconds: 60 };
      },
    }),
    checkIn: async () => {
      writes++;
      throw createAppError('NOT_FOUND');
    },
  });
  const send = (index: number) => {
    const roundId = `r${index.toString().padStart(23, '0')}`;
    return handler(
      new Request(`${origin}/api/rounds/${roundId}/check-in`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({
          version: 1,
          commandId: 'c'.repeat(24),
          segmentId: 's'.repeat(24),
        }),
      }),
      roundId,
    );
  };
  const statuses = [];
  for (let index = 0; index < 121; index++)
    statuses.push((await send(index)).status);
  assert({
    given: '121 different well-formed round ids submitted by one member',
    should: 'stop at the member ceiling before another lookup or transaction',
    actual: { statuses, buckets: uses.size, lookups, writes },
    expected: {
      statuses: [...Array<number>(120).fill(404), 429],
      buckets: 1,
      lookups: 120,
      writes: 120,
    },
  });
  userId = 'b'.repeat(24);
  assert({
    given: 'another member after the first member exhausts their budget',
    should: 'retain an independent budget',
    actual: (await send(122)).status,
    expected: 404,
  });
  unavailable = true;
  assert({
    given: 'an unavailable attendance limiter',
    should: 'fail closed before actor lookup or durable work',
    actual: { status: (await send(123)).status, lookups, writes },
    expected: { status: 503, lookups: 121, writes: 121 },
  });
});
