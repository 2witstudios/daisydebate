import { assert, setupRitewayBun, test } from 'riteway/bun';
import { botIdentity, createStreamTracker } from './capture-streams';
import type { CaptureState } from './capture-history';
setupRitewayBun();

const segment = {
  id: 'seg1',
  startedAt: '2026-10-22T12:00:00.000Z',
  endedAt: '2026-10-22T12:00:40.000Z',
  durationMs: 40000,
  returnedMs: 0,
};
const interval = (
  roundParticipantId: string,
  startedAt: string,
  endedAt: string | null,
) => ({ roundParticipantId, startedAt, endedAt });
const state = (
  intervals: ReturnType<typeof interval>[],
  bots: readonly string[] = [],
) =>
  ({
    segment,
    intervals,
    participants: bots.map((roundParticipantId) => ({
      roundParticipantId,
      kind: 'bot',
      identity: roundParticipantId,
    })),
    serverNow: '2026-10-22T12:00:50.000Z',
  }) as unknown as CaptureState;
const keys = (tracker: ReturnType<typeof createStreamTracker>) =>
  [...tracker.values()].map(
    (s) => `${s.segmentId}/${s.roundParticipantId}:${s.count}`,
  );

test('a bot seat owes capture no stream: its transcript is authored (ADR 0122)', () => {
  const tracker = createStreamTracker(16);
  tracker.remember(
    state(
      [
        interval(
          'human',
          '2026-10-22T12:00:00.000Z',
          '2026-10-22T12:00:20.000Z',
        ),
        interval('bot', '2026-10-22T12:00:20.000Z', '2026-10-22T12:00:40.000Z'),
      ],
      ['bot'],
    ),
  );
  assert({
    given: 'a human grant and a bot grant in one segment',
    should: 'expect a captured stream for the human only',
    actual: keys(tracker),
    expected: ['seg1/human:0'],
  });
});

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

const speaker = { segmentId: 'seg1', roundParticipantId: 'speaker' };
const at = (iso: string) => Date.parse(iso);
const due = (tracker: ReturnType<typeof createStreamTracker>, now: string) =>
  tracker
    .due(at(now), () => false)
    .map((s) => `${s.segmentId}/${s.roundParticipantId}`);

test('an ended segment seals its streams once they settle with nothing in flight', () => {
  const tracker = createStreamTracker(16);
  tracker.remember(
    state([interval('speaker', '2026-10-22T12:00:00.000Z', null)]),
  );
  assert({
    given: 'a segment that ended at 12:00:40 and a seat with no clip in flight',
    should:
      'not seal within the 750 ms settle window, then seal once it has passed (VIDEO-4.1)',
    actual: [
      due(tracker, '2026-10-22T12:00:40.500Z'),
      due(tracker, '2026-10-22T12:00:41.000Z'),
    ],
    expected: [[], ['seg1/speaker']],
  });
});

test('a stream with a clip queued or in transcription is not due', () => {
  const tracker = createStreamTracker(16);
  tracker.remember(
    state([interval('speaker', '2026-10-22T12:00:00.000Z', null)]),
  );
  tracker.queued(speaker);
  const pending = due(tracker, '2026-10-22T12:00:45.000Z');
  tracker.settled(speaker);
  assert({
    given: 'an ended segment whose seat still has one clip pending, then none',
    should: 'wait for that clip to settle before the stream is due',
    actual: [pending, due(tracker, '2026-10-22T12:00:45.000Z')],
    expected: [[], ['seg1/speaker']],
  });
});

test('a stream whose frames are still staged is not due', () => {
  const tracker = createStreamTracker(16);
  tracker.remember(
    state([interval('speaker', '2026-10-22T12:00:00.000Z', null)]),
  );
  let staged = true;
  const holds = () => staged;
  const waiting = tracker
    .due(at('2026-10-22T12:00:45.000Z'), holds)
    .map((s) => s.roundParticipantId);
  staged = false;
  assert({
    given:
      'an ended segment whose seat still has frames in staging after the settle window, then none (ISSUE-577)',
    should:
      'wait until staging has handed them over, instead of assuming a staged frame expires',
    actual: [
      waiting,
      tracker
        .due(at('2026-10-22T12:00:45.000Z'), holds)
        .map((s) => s.roundParticipantId),
    ],
    expected: [[], ['speaker']],
  });
});

test('a finished stream is never due again', () => {
  const tracker = createStreamTracker(16);
  tracker.remember(
    state([interval('speaker', '2026-10-22T12:00:00.000Z', null)]),
  );
  tracker.finished(speaker);
  assert({
    given: 'a stream the worker has sealed, or seen definitely refused',
    should: 'leave it out of every later due set',
    actual: due(tracker, '2026-10-22T12:01:00.000Z'),
    expected: [],
  });
});

test('a segment the history has moved past counts as ended when first seen superseded', () => {
  const tracker = createStreamTracker(16);
  tracker.remember({
    segment: { ...segment, endedAt: null },
    intervals: [interval('speaker', '2026-10-22T12:00:00.000Z', null)],
    participants: [],
    serverNow: '2026-10-22T12:00:20.000Z',
  } as unknown as CaptureState);
  const open = due(tracker, '2026-10-22T12:00:30.000Z');
  tracker.remember({
    segment: null,
    intervals: [],
    participants: [],
    serverNow: '2026-10-22T12:00:30.000Z',
  } as unknown as CaptureState);
  assert({
    given: 'a stream whose open segment is next read as superseded at 12:00:30',
    should: 'treat it as ended then, and due once the settle window passes',
    actual: [open, due(tracker, '2026-10-22T12:00:31.000Z')],
    expected: [[], ['seg1/speaker']],
  });
});

test('a bot seat’s track identity is known, so its frames are never staged (ADR 0122)', () => {
  const current = state([], ['bot-seat']);
  assert({
    given: 'a Round with a bot seat',
    should: 'name the bot’s track identity a bot’s, and no other',
    actual: [botIdentity(current, 'bot-seat'), botIdentity(current, 'human')],
    expected: [true, false],
  });
});
