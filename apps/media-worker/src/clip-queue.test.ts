import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createClipQueue } from './clip-queue';
setupRitewayBun();
test('capture queue drops oldest by clip, byte and duration limits', () => {
  const queue = createClipQueue<{
    id: number;
    bytes: number;
    durationMs: number;
  }>({ maxClips: 2, maxBytes: 8, maxDurationMs: 30 });
  queue.push({ id: 1, bytes: 4, durationMs: 10 });
  queue.push({ id: 2, bytes: 4, durationMs: 10 });
  const dropped = queue.push({ id: 3, bytes: 4, durationMs: 10 });
  assert({
    given: 'three clips beyond the independent queue capacity',
    should: 'drop oldest and retain bounded order',
    actual: {
      dropped: dropped.map((x) => x.id),
      next: queue.shift()?.id,
      last: queue.shift()?.id,
      empty: queue.shift(),
    },
    expected: { dropped: [1], next: 2, last: 3, empty: undefined },
  });
  const huge = queue.push({ id: 4, bytes: 9, durationMs: 10 });
  const long = queue.push({ id: 5, bytes: 4, durationMs: 31 });
  assert({
    given: 'single clips exceeding byte or duration bounds',
    should: 'retain neither',
    actual: [huge.map((x) => x.id), long.map((x) => x.id), queue.shift()],
    expected: [[4], [5], undefined],
  });
});
