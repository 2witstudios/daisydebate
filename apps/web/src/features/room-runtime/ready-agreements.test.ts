import {
  CONTENT_WAIVER_VERSION,
  casualCaptureNotice,
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
const version = casualCaptureNotice.version;

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
      expected: [casualCaptureNotice, 'capture-notice-changed', null],
    });
  });

  test('the notice a Room shows', () => {
    assert({
      given:
        'a ranked Room, a ranked Room carrying a capture choice, and a casual Room with no opt-in',
      should: 'show no notice on any of them',
      actual: [
        roomCaptureNotice(ranked),
        roomCaptureNotice({ ...ranked, capture: optedIn.capture }),
        roomCaptureNotice(casual),
      ],
      expected: [null, null, null],
    });
  });

  test('Ready must state the notice its form showed', () => {
    assert({
      given: 'a ranked Ready stating no notice, and one stating a notice',
      should:
        'accept the first on the waiver alone, and refuse words no ranked form shows',
      actual: [
        captureNoticeRefusal(ranked, undefined),
        captureNoticeRefusal(ranked, version),
      ],
      expected: [null, 'capture-notice-changed'],
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
  test('a ranked create needs and records none', () => {
    assert({
      given: 'a ranked create stating no notice, and one stating a notice',
      should: 'record nothing for the first and refuse the second',
      actual: [
        createNoticeOf(ranked, undefined),
        createNoticeOf(ranked, version),
      ],
      expected: [{ kind: 'none' }, { kind: 'refused' }],
    });
  });

  test('a casual create with no capture has none to state', () => {
    assert({
      given: 'a casual create stating no notice, and one stating a notice',
      should: 'ask for nothing, and refuse a notice no such form shows',
      actual: [
        createNoticeOf(casual, undefined),
        createNoticeOf(casual, version),
      ],
      expected: [{ kind: 'none' }, { kind: 'refused' }],
    });
  });

  test('a casual recording create records only the exact notice shown to its host', () => {
    assert({
      given: 'a casual recording create with current, stale and absent notice',
      should: 'record only the current shown words',
      actual: [
        createNoticeOf(optedIn, version),
        createNoticeOf(optedIn, 'casual-draft-0'),
        createNoticeOf(optedIn, undefined),
      ],
      expected: [
        { kind: 'shown', notice: casualCaptureNotice },
        { kind: 'refused' },
        { kind: 'none' },
      ],
    });
  });
});
