import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  debatersReadChat,
  delayAlert,
  factReleased,
  releasedThrough,
  resolveReleasePolicy,
  segmentDue,
} from './broadcast-release';

setupRitewayBun();

const at = (seconds: number) => 1_000_000 + seconds * 1000;
const segment = (seconds: number) => ({
  capturedAtMs: at(seconds),
  durationMs: 4000,
});

describe('resolveReleasePolicy', () => {
  test('ranked is fixed; casual defaults and honours the host', () => {
    assert({
      given: 'a ranked Round asking for any other release',
      should: 'fix the delay at 60 seconds',
      actual: [
        resolveReleasePolicy('ranked', null),
        resolveReleasePolicy('ranked', { kind: 'delay', seconds: 5 }),
        resolveReleasePolicy('ranked', { kind: 'round_end' }),
      ],
      expected: [
        { kind: 'delay', seconds: 60 },
        { kind: 'delay', seconds: 60 },
        { kind: 'delay', seconds: 60 },
      ],
    });
    assert({
      given: 'a casual Round with no choice, and with each host choice',
      should: 'default to 60 seconds and otherwise keep the choice',
      actual: [
        resolveReleasePolicy('casual', null),
        resolveReleasePolicy('casual', { kind: 'delay', seconds: 0 }),
        resolveReleasePolicy('casual', { kind: 'round_end' }),
        resolveReleasePolicy('casual', { kind: 'at', atMs: at(900) }),
      ],
      expected: [
        { kind: 'delay', seconds: 60 },
        { kind: 'delay', seconds: 0 },
        { kind: 'round_end' },
        { kind: 'at', atMs: at(900) },
      ],
    });
  });
});

describe('segmentDue', () => {
  const delay = { kind: 'delay', seconds: 60 } as const;
  test('a delay counts from the end of the segment', () => {
    assert({
      given: 'a 4 s segment captured at 0 with a 60 s delay',
      should:
        'hold it until 64 s, so its last frame is never younger than the delay',
      actual: [
        segmentDue(delay, segment(0), {
          nowMs: at(63.999),
          roundEndedAtMs: null,
        }),
        segmentDue(delay, segment(0), { nowMs: at(64), roundEndedAtMs: null }),
      ],
      expected: [false, true],
    });
  });
  test('Round-end release waits for the end, however old the media is', () => {
    const policy = { kind: 'round_end' } as const;
    assert({
      given: 'a Round-end hold before and after the Round ends',
      should: 'release nothing until it ends',
      actual: [
        segmentDue(policy, segment(0), {
          nowMs: at(9000),
          roundEndedAtMs: null,
        }),
        segmentDue(policy, segment(0), {
          nowMs: at(9000),
          roundEndedAtMs: at(9001),
        }),
        segmentDue(policy, segment(0), {
          nowMs: at(9001),
          roundEndedAtMs: at(9001),
        }),
      ],
      expected: [false, false, true],
    });
  });
  test('a set time holds until that time and never before capture ends', () => {
    const policy = { kind: 'at', atMs: at(100) } as const;
    assert({
      given: 'a set release time, and a segment still being captured past it',
      should: 'release at the set time, and only once the segment is complete',
      actual: [
        segmentDue(policy, segment(0), { nowMs: at(99), roundEndedAtMs: null }),
        segmentDue(policy, segment(0), {
          nowMs: at(100),
          roundEndedAtMs: null,
        }),
        segmentDue(policy, segment(99), {
          nowMs: at(100),
          roundEndedAtMs: null,
        }),
      ],
      expected: [false, true, false],
    });
  });
});

describe('releasedThrough', () => {
  test('the watermark is the end of the released media', () => {
    assert({
      given: 'no released segment, then segments released in order',
      should: 'report no watermark, then the end of the newest',
      actual: [
        releasedThrough(null, segment(0)),
        releasedThrough(at(4), segment(4)),
      ],
      expected: [at(4), at(8)],
    });
  });
  test('the watermark never moves backwards', () => {
    assert({
      given: 'a replayed older segment after a crash',
      should: 'keep the higher watermark',
      actual: releasedThrough(at(8), segment(0)),
      expected: at(8),
    });
  });
});

describe('factReleased', () => {
  const margin = { marginMs: 5000 };
  test('a fact follows released media, never the clock', () => {
    assert({
      given: 'no watermark yet, however long ago the fact was captured',
      should: 'not release it',
      actual: factReleased(at(0), null, margin),
      expected: false,
    });
    assert({
      given:
        'a fact captured at 100 s and a watermark just short of the margin',
      should: 'hold it until the watermark passes capture plus margin',
      actual: [
        factReleased(at(100), at(104.999), margin),
        factReleased(at(100), at(105), margin),
      ],
      expected: [false, true],
    });
  });
});

describe('delayAlert', () => {
  test('real delay past the recorded bound raises an alert', () => {
    assert({
      given: 'a watermark 90 s and then 90.001 s behind the clock',
      should: 'alert only past 90 seconds',
      actual: [
        delayAlert(at(0), at(90), { boundMs: 90_000 }),
        delayAlert(at(0), at(90.001), { boundMs: 90_000 }),
      ],
      expected: [false, true],
    });
  });
});

test('debaters read chat only off ranked, with a host off switch', () => {
  assert({
    given:
      'ranked with the host allowing, casual allowing, casual switched off',
    should: 'allow only casual with the switch on',
    actual: [
      debatersReadChat('ranked', true),
      debatersReadChat('casual', true),
      debatersReadChat('casual', false),
    ],
    expected: [false, true, false],
  });
});
