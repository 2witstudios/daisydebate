import { assert, setupRitewayBun, test } from 'riteway/bun';
import { readTranscript } from './read-transcript';
setupRitewayBun();

const roundId = 'r'.repeat(24);
const answering = (status: number) => async () => new Response('x', { status });

test('only an authorization answer clears the transcript', async () => {
  const kinds = await Promise.all(
    [401, 403, 404, 500, 502, 503].map(async (status) => [
      status,
      (await readTranscript(answering(status), roundId)).kind,
    ]),
  );
  const down = await readTranscript(async () => {
    throw new Error('connection refused');
  }, roundId);
  assert({
    given: 'refusals, server failures and a failed connection',
    should: 'read refusals as missing and everything else as unavailable',
    actual: [...kinds, down.kind],
    expected: [
      [401, 'missing'],
      [403, 'missing'],
      [404, 'missing'],
      [500, 'unavailable'],
      [502, 'unavailable'],
      [503, 'unavailable'],
      'unavailable',
    ],
  });
});
