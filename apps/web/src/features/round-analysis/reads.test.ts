import { assert, setupRitewayBun, test } from 'riteway/bun';
import { readRoundAnalysis } from './reads';

setupRitewayBun();

const roundId = 'a'.repeat(24);
const read = (status: number, headers: HeadersInit = {}) =>
  readRoundAnalysis(
    async () => new Response(null, { status, headers }),
    roundId,
  );

test('a round analysis read says whether asking again can help', async () => {
  assert({
    given: 'a denial, a temporary refusal and a failure that may last',
    should: 'read as missing, temporary and plainly unavailable',
    actual: await Promise.all([
      read(401),
      read(403),
      read(404),
      read(503, { 'retry-after': '1' }),
      read(503),
      read(500),
    ]),
    expected: [
      { kind: 'missing' },
      { kind: 'missing' },
      { kind: 'missing' },
      { kind: 'unavailable', temporary: true },
      { kind: 'unavailable' },
      { kind: 'unavailable' },
    ],
  });
});
