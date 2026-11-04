import { assert, setupRitewayBun, test } from 'riteway/bun';
import { segmentDueAtMs, speakingEndMs } from './segment-end';
setupRitewayBun();
test('segmentDueAtMs', () => {
  assert({
    given: 'a segment that started at 1000 with a 500 ms duration',
    should: 'be due at 1500',
    actual: segmentDueAtMs({
      startedAtMs: 1000,
      durationMs: 500,
      returnedMs: 0,
    }),
    expected: 1500,
  });
});
test('speakingEndMs', () => {
  const segment = { startedAtMs: 1000, durationMs: 500, returnedMs: 0 };
  assert({
    given: 'a segment with no close',
    should: 'end speaking at its due instant',
    actual: speakingEndMs({ ...segment, endedAtMs: null }),
    expected: 1500,
  });
  assert({
    given: 'a segment closed before it was due',
    should: 'end speaking at the close',
    actual: speakingEndMs({ ...segment, endedAtMs: 1200 }),
    expected: 1200,
  });
  assert({
    given: 'a segment whose close was written after it was due',
    should: 'still end speaking at its due instant',
    actual: speakingEndMs({ ...segment, endedAtMs: 1900 }),
    expected: 1500,
  });
});
