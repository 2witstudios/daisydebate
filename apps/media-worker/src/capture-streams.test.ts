import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createStreamTracker } from './capture-streams';
import type { CaptureState } from './capture-history';
setupRitewayBun();

const segment = {
  id: 'seg1',
  startedAt: '2026-10-22T12:00:00.000Z',
  endedAt: '2026-10-22T12:00:40.000Z',
  durationMs: 40000,
};
const interval = (
  roundParticipantId: string,
  startedAt: string,
  endedAt: string | null,
) => ({ roundParticipantId, startedAt, endedAt });
const state = (intervals: ReturnType<typeof interval>[]) =>
  ({
    segment,
    intervals,
    serverNow: '2026-10-22T12:00:50.000Z',
  }) as unknown as CaptureState;
const keys = (tracker: ReturnType<typeof createStreamTracker>) =>
  [...tracker.values()].map(
    (s) => `${s.segmentId}/${s.roundParticipantId}:${s.count}`,
  );

test('a committed speaking interval with no clips is still an expected stream', () => {
  const tracker = createStreamTracker(16);
  tracker.remember(
    state([
      interval(
        'silent',
        '2026-10-22T12:00:00.000Z',
        '2026-10-22T12:00:40.000Z',
      ),
      interval('empty', '2026-10-22T12:00:10.000Z', '2026-10-22T12:00:10.000Z'),
      interval('after', '2026-10-22T12:00:40.000Z', null),
    ]),
  );
  assert({
    given:
      'a nonempty interval, an empty provenance interval and one starting at the segment end',
    should: 'expect only the nonempty in-segment seat, with zero chunks',
    actual: keys(tracker),
    expected: ['seg1/silent:0'],
  });
});

test('clips and expected streams share one count per segment seat', () => {
  const tracker = createStreamTracker(16);
  tracker.remember(
    state([interval('speaker', '2026-10-22T12:00:00.000Z', null)]),
  );
  tracker.forClip({ segmentId: 'seg1', roundParticipantId: 'speaker' }).count++;
  tracker.remember(
    state([interval('speaker', '2026-10-22T12:00:00.000Z', null)]),
  );
  assert({
    given: 'a remembered stream that then commits a clip and is re-remembered',
    should: 'keep one stream with the committed count',
    actual: keys(tracker),
    expected: ['seg1/speaker:1'],
  });
});

test('the tracker refuses to grow past its stream ceiling', () => {
  const tracker = createStreamTracker(1);
  tracker.forClip({ segmentId: 'seg1', roundParticipantId: 'a' });
  let code = 'accepted';
  try {
    tracker.forClip({ segmentId: 'seg1', roundParticipantId: 'b' });
  } catch (error) {
    code = (error as { code: string }).code;
  }
  assert({
    given: 'a second stream beyond a ceiling of one',
    should: 'refuse rather than grow unbounded',
    actual: code,
    expected: 'INFRASTRUCTURE',
  });
});
