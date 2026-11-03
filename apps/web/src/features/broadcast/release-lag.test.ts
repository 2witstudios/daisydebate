import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { releaseOverdue } from './release-lag';

setupRitewayBun();

const at = (seconds: number) => new Date(seconds * 1000);
const row = (over = {}) => ({
  releasePolicy: { kind: 'delay', seconds: 60 } as const,
  egressStartedAt: at(0),
  releasedThroughAt: at(100),
  finalMediaEndAt: null,
  stoppedAt: null,
  completedAt: null,
  ...over,
});

describe('releaseOverdue', () => {
  test('alerts past the policy plus the margin, and not before', () => {
    assert({
      given: 'a ranked delay at exactly 90 s behind, then just past it',
      should: 'alert only past the bound',
      actual: [releaseOverdue(row(), 190_000), releaseOverdue(row(), 190_001)],
      expected: [false, true],
    });
  });
  test('a new Egress attempt restarts the clock; nothing released yet still counts', () => {
    assert({
      given:
        'an old watermark and a recent restart, then no release since a start',
      should: 'measure from the later of the two',
      actual: [
        releaseOverdue(row({ egressStartedAt: at(150) }), 200_000),
        releaseOverdue(row({ releasedThroughAt: null }), 91_000),
      ],
      expected: [false, true],
    });
  });
  test('nothing is owed once it is all out, stopped, or on a hold', () => {
    const late = 1_000_000;
    assert({
      given:
        'media fully released, a stop, a completion, a round_end hold, no Egress',
      should: 'not alert',
      actual: [
        row({ finalMediaEndAt: at(100) }),
        row({ stoppedAt: at(1) }),
        row({ completedAt: at(1) }),
        row({ releasePolicy: { kind: 'round_end' } }),
        row({ egressStartedAt: null }),
      ].map((broadcast) => releaseOverdue(broadcast, late)),
      expected: [false, false, false, false, false],
    });
  });
  test('held media past the end still counts', () => {
    assert({
      given: 'a stopped Egress with media still unreleased',
      should: 'keep alerting',
      actual: releaseOverdue(row({ finalMediaEndAt: at(200) }), 300_000),
      expected: true,
    });
  });
});
