import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { captureNoticeRefusal, roomCaptureNotice } from './ready-agreements';

setupRitewayBun();

const ranked = { competitionType: 'ranked' as const };
const casual = { competitionType: 'casual' as const };
const version = roomCaptureNotice(ranked)!.version;

describe('Ready agreements', () => {
  test('the notice a Room shows', () => {
    assert({
      given: 'a ranked and a casual Room with no opt-in',
      should: 'show the ranked notice and nothing on the casual Room',
      actual: [roomCaptureNotice(ranked)?.version, roomCaptureNotice(casual)],
      expected: ['ranked-draft-1', null],
    });
  });

  test('Ready must state the notice its form showed', () => {
    assert({
      given: 'a ranked Ready stating the current, a stale and no notice',
      should: 'accept only the current one',
      actual: [
        captureNoticeRefusal(ranked, version),
        captureNoticeRefusal(ranked, 'ranked-draft-0'),
        captureNoticeRefusal(ranked, undefined),
      ],
      expected: [null, 'capture-notice-changed', 'capture-notice-changed'],
    });
    assert({
      given: 'a casual Ready with no notice to state',
      should: 'accept it, and refuse one claiming a notice that does not exist',
      actual: [
        captureNoticeRefusal(casual, undefined),
        captureNoticeRefusal(casual, version),
      ],
      expected: [null, 'capture-notice-changed'],
    });
  });
});
