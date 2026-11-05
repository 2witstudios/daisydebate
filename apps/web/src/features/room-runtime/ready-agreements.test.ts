import {
  CONTENT_WAIVER_VERSION,
  roundCaptureNotice,
} from '../legal/agreements';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  captureNoticeRefusal,
  contentWaiverRefusal,
  createNoticeOf,
  requiredContentWaiver,
  roomCaptureNotice,
} from './ready-agreements';

setupRitewayBun();

const ranked = { competitionType: 'ranked' as const, capture: null };
const casual = { competitionType: 'casual' as const, capture: null };
const optedIn = {
  competitionType: 'casual' as const,
  capture: { broadcast: null, recording: true },
};
const version = roomCaptureNotice(ranked)!.version;

describe('Ready agreements', () => {
  test('only ranked needs the waiver', () => {
    assert({
      given: 'a ranked and a casual Room',
      should: 'require the current waiver on ranked alone',
      actual: [requiredContentWaiver(ranked), requiredContentWaiver(casual)],
      expected: [CONTENT_WAIVER_VERSION, null],
    });
  });

  test('where a member stands on the waiver decides Ready', () => {
    assert({
      given: 'signed, unsigned, no season, and no waiver needed',
      should: 'refuse only unsigned and no season',
      actual: [
        contentWaiverRefusal('signed'),
        contentWaiverRefusal('unsigned'),
        contentWaiverRefusal('no-active-season'),
        contentWaiverRefusal(null),
      ],
      expected: [null, 'content-waiver-required', 'ranked-unavailable', null],
    });
  });

  test('a casual host who opted in owes every seat the opted-in notice', () => {
    assert({
      given: 'a casual Room whose host chose a recording',
      should: 'show the opted-in notice and hold Ready to its version',
      actual: [
        roomCaptureNotice(optedIn),
        captureNoticeRefusal(optedIn, undefined),
        captureNoticeRefusal(optedIn, roomCaptureNotice(optedIn)!.version),
      ],
      expected: [
        roundCaptureNotice('opted-in'),
        'capture-notice-changed',
        null,
      ],
    });
  });

  test('the notice a Room shows', () => {
    assert({
      given: 'a ranked and a casual Room with no opt-in',
      should: 'show the ranked notice and nothing on the casual Room',
      actual: [roomCaptureNotice(ranked)?.version, roomCaptureNotice(casual)],
      expected: ['ranked-draft-2', null],
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

describe('the notice a create form showed', () => {
  test('is recorded only when it is the one served now', () => {
    const notice = roundCaptureNotice('ranked')!;
    assert({
      given:
        'a ranked create stating the current notice, a stale one, none from a seatless host, and none from a seated host',
      should:
        'show the first, refuse the next two, and leave the last to its Ready',
      actual: [
        createNoticeOf('ranked', notice.version, false),
        createNoticeOf('ranked', 'ranked-draft-0', false),
        createNoticeOf('ranked', undefined, false),
        createNoticeOf('ranked', undefined, true),
      ],
      expected: [
        { kind: 'shown', notice },
        { kind: 'refused' },
        { kind: 'refused' },
        { kind: 'none' },
      ],
    });
    assert({
      given: 'a casual create stating a notice no casual form shows',
      should: 'refuse it',
      actual: createNoticeOf('casual', notice.version, false),
      expected: { kind: 'refused' },
    });
    assert({
      given: 'a casual create with no notice and no seat',
      should: 'ask for nothing',
      actual: createNoticeOf('casual', undefined, false),
      expected: { kind: 'none' },
    });
  });
});

test('initial casual recording records only the exact notice shown to its host', () => {
  const notice = roundCaptureNotice('opted-in')!;
  assert({
    given:
      'a seatless casual recording create with current, stale and absent notice',
    should: 'record only the current shown words',
    actual: [
      createNoticeOf('casual', notice.version, false, optedIn.capture),
      createNoticeOf('casual', 'casual-draft-0', false, optedIn.capture),
      createNoticeOf('casual', undefined, false, optedIn.capture),
    ],
    expected: [
      { kind: 'shown', notice },
      { kind: 'refused' },
      { kind: 'none' },
    ],
  });
});
