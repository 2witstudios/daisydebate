import { assert, setupRitewayBun, test } from 'riteway/bun';
import { subscriptionFreshness } from './subscription-staleness';

setupRitewayBun();
const freshness = (
  facts: Parameters<typeof subscriptionFreshness>[0],
  complete: boolean,
) =>
  subscriptionFreshness(facts, complete, {
    startedAt: facts.sampledAt,
    pages: 1,
  });
const now = '2026-11-07T12:20:00.000Z';
const sample = {
  sampledAt: now,
  scanned: 1,
  pending: 0,
  claimed: 0,
  settled: 1,
  unconfirmed: 0,
  oldestRevisionRequestedAt: null,
  oldestObservedAt: '2026-11-07T12:19:00.000Z',
};

test('freshness uses the actual observation and requested age, with an exact fifteen-minute boundary', () => {
  const status = (oldestObservedAt: string) =>
    freshness({ ...sample, oldestObservedAt }, true).status;
  assert({
    given:
      'a genuine successful observation exactly at the target or one millisecond older',
    should:
      'distinguish within-target from stale without refreshing the data timestamp at collection',
    actual: [
      status('2026-11-07T12:05:00.000Z'),
      status('2026-11-07T12:04:59.999Z'),
    ],
    expected: ['within_target', 'stale'],
  });
  const pending = freshness(
    {
      ...sample,
      pending: 1,
      settled: 0,
      oldestRevisionRequestedAt: '2026-11-07T12:00:00.000Z',
      oldestObservedAt: '2026-11-07T12:19:00.000Z',
    },
    true,
  );
  assert({
    given: 'a recent successful observation but an older pending request',
    should: 'expose the pending target breach independently',
    actual: [
      pending.status,
      pending.oldestRevisionRequestAgeMs,
      pending.targetMs,
    ],
    expected: ['stale', 1_200_000, 900_000],
  });
});

test('unconfirmed, partial and invalid-clock observations cannot become healthy', () => {
  assert({
    given:
      'unproven initialization, incomplete coverage, future data or an empty completed cohort',
    should:
      'keep uncertainty distinct from a measured empty cohort and from health',
    actual: [
      freshness({ ...sample, unconfirmed: 1, oldestObservedAt: null }, true)
        .status,
      freshness(sample, false).status,
      freshness(
        { ...sample, oldestObservedAt: '2026-11-07T12:21:00.000Z' },
        true,
      ).status,
      freshness(
        { ...sample, scanned: 0, settled: 0, oldestObservedAt: null },
        true,
      ).status,
    ],
    expected: ['unconfirmed', 'partial', 'unavailable', 'empty'],
  });
  assert({
    given: 'a partial scan that already found a proven breach',
    should:
      'report the known stale lower bound without claiming complete coverage',
    actual: freshness(
      { ...sample, oldestObservedAt: '2026-11-07T12:00:00.000Z' },
      false,
    ).status,
    expected: 'stale',
  });
});
