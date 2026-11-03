import { assert, setupRitewayBun, test } from 'riteway/bun';
import { judgingPolicy, roundMediaPolicy } from '@daisy/protocol';
import { mediaWindowClosed, mediaWindowEndsAt } from './media-window';

setupRitewayBun();

const end = '2026-10-22T12:00:00.000Z';

test('mediaWindowClosed()', () => {
  assert({
    given: 'live and finished Rounds around the final end',
    should: 'close for finished Rounds and from exactly the window after',
    actual: [
      mediaWindowClosed('opening', end, null),
      mediaWindowClosed('active', '2026-10-22T12:29:59.999Z', end),
      mediaWindowClosed('active', '2026-10-22T12:30:00.000Z', end),
      mediaWindowClosed('completed', end, null),
      mediaWindowClosed('abandoned', end, null),
    ],
    expected: [false, false, true, true, true],
  });
});

test('mediaWindowEndsAt()', () => {
  assert({
    given: 'a final segment end',
    should: 'add the media policy window',
    actual: mediaWindowEndsAt(end) - Date.parse(end),
    expected: roundMediaPolicy.windowAfterFinalSegmentMs,
  });
  assert({
    given: 'the two policies',
    should: 'keep media and the ballot deadline as separate named bounds',
    actual: 'windowAfterFinalSegmentMs' in judgingPolicy,
    expected: false,
  });
});
