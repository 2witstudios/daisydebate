import { assert, setupRitewayBun, test } from 'riteway/bun';
import { round } from '../room-runtime/operations.test-support';
import { readTranscript } from './read-transcript';
setupRitewayBun();
test('protected transcript reads validate identity and clear denied access', async () => {
  const value = {
    round,
    revision: 0,
    freeze: null,
    streams: [],
    utterances: [],
  };
  const outcomes = [];
  for (const response of [
    Response.json(value),
    Response.json({ ...value, round: { ...round, id: 'x'.repeat(24) } }),
    new Response(null, { status: 403 }),
    new Response(null, { status: 503 }),
    Response.json({ ...value, streams: [{ state: 'invented' }] }),
  ]) {
    outcomes.push((await readTranscript(async () => response, round.id)).kind);
  }
  assert({
    given: 'valid, foreign, denied, unavailable and corrupt transcript reads',
    should:
      'adopt only the requested validated snapshot and discard denied access',
    actual: outcomes,
    expected: ['found', 'unavailable', 'missing', 'unavailable', 'unavailable'],
  });
});
