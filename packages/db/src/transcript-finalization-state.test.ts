import { assert, setupRitewayBun, test } from 'riteway/bun';
import { finalizationState } from './transcript-finalization-state';

setupRitewayBun();

const a = { segmentId: 'segment-a', roundParticipantId: 'speaker-a' };
const b = { segmentId: 'segment-b', roundParticipantId: 'speaker-b' };
const before = '2026-10-22T12:00:01.000Z';
const cutoff = '2026-10-22T12:00:02.000Z';
const after = '2026-10-22T12:00:03.000Z';
const stream = (key: typeof a, state: string) => ({ ...key, state });

test('before the cutoff an unclosed expected stream keeps capture open', () => {
  assert({
    given: 'an open, a missing, and no expected stream before the cutoff',
    should: 'keep capturing in each case',
    actual: [
      finalizationState(
        {
          expected: [a, b],
          streams: [stream(a, 'complete'), stream(b, 'open')],
        },
        before,
        cutoff,
      ),
      finalizationState(
        { expected: [a, b], streams: [stream(a, 'complete')] },
        before,
        cutoff,
      ),
      finalizationState({ expected: [], streams: [] }, before, cutoff),
    ],
    expected: ['capture', 'capture', 'capture'],
  });
});

test('every expected stream sealed complete freezes complete before the cutoff', () => {
  assert({
    given: 'all expected streams complete and no other stream',
    should: 'freeze complete without waiting for the cutoff',
    actual: finalizationState(
      {
        expected: [a, b],
        streams: [stream(a, 'complete'), stream(b, 'complete')],
      },
      before,
      cutoff,
    ),
    expected: 'complete',
  });
});

test('partial, missing, open or unexpected streams freeze incomplete', () => {
  const closed = { expected: [a, b] };
  assert({
    given: 'closed or cut-off stream sets that are not wholly complete',
    should: 'freeze incomplete rather than claim a complete transcript',
    actual: [
      finalizationState(
        { ...closed, streams: [stream(a, 'complete'), stream(b, 'partial')] },
        before,
        cutoff,
      ),
      finalizationState(
        { ...closed, streams: [stream(a, 'complete')] },
        cutoff,
        cutoff,
      ),
      finalizationState(
        { ...closed, streams: [stream(a, 'complete'), stream(b, 'open')] },
        after,
        cutoff,
      ),
      finalizationState(
        {
          expected: [a],
          streams: [stream(a, 'complete'), stream(b, 'partial')],
        },
        after,
        cutoff,
      ),
      finalizationState({ expected: [], streams: [] }, after, cutoff),
    ],
    expected: [
      'incomplete',
      'incomplete',
      'incomplete',
      'incomplete',
      'incomplete',
    ],
  });
});
