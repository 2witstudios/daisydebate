import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAppError } from '@daisy/errors';
import {
  failureNotice,
  isFailureRaised,
  nothingRaised,
  owedSignals,
  raisedIn,
  recordFailure,
  recordFeedMissingLogged,
  recordSignals,
  signalFailureNotice,
} from './economics-notice';
import { buildEconomicsReport } from './economics-report';
import { dataset, now } from './economics.test-support';
setupRitewayBun();

const built = buildEconomicsReport(dataset(), now);
if (built.kind !== 'report') throw Error('Expected a valid report');
const validReport = built;

const failed = (month: string, reason: 'feed_unreadable' | 'save_failed') =>
  ({
    kind: 'failed',
    month,
    reason,
    cause: new Error(`private ${reason}`),
  }) as const;
const reported = (
  month: string,
  feed: 'supplied' | 'missing',
  plans: readonly ('free' | 'beta' | 'premium')[],
) =>
  ({
    kind: 'reported',
    month,
    feed,
    report: validReport,
    signals: plans.map((plan) => ({
      name: 'BILLING_ECONOMICS_INCOMPLETE' as const,
      plan,
    })),
  }) as const;
const settle = (
  raised: Parameters<typeof recordSignals>[0],
  report: ReturnType<typeof reported>,
) =>
  recordSignals(raised, report, {
    taken: owedSignals(raised, report),
    settled: true,
  });
const plans = (signals: readonly { readonly plan: string }[]) =>
  signals.map((s) => s.plan);

test('the same failure every hour is one notice; a different code in the stage is another', () => {
  const capacity = {
    ...failed('2026-10', 'save_failed'),
    cause: createAppError('INFRASTRUCTURE', 'capacity'),
  };
  assert({
    given:
      'two failures of one stage with distinct untyped errors, and one with a typed INFRASTRUCTURE error',
    should:
      'share a notice for the untyped pair and give the typed one its own',
    actual: [
      failureNotice(failed('2026-10', 'save_failed')),
      failureNotice(capacity),
    ],
    expected: [
      '2026-10:save_failed:INTERNAL',
      '2026-10:save_failed:INFRASTRUCTURE',
    ],
  });
});

test('each signal is raised once a month, whatever else changes in the report', () => {
  const missing = reported('2026-10', 'missing', ['free', 'beta', 'premium']);
  const supplied = reported('2026-10', 'supplied', ['beta', 'premium']);
  const raised = settle(nothingRaised, missing);
  assert({
    given:
      'a missing-feed report raising three signals, then a supplied feed still leaving beta and premium',
    should: 'owe nothing for the second report',
    actual: plans(owedSignals(raised, supplied)),
    expected: [],
  });
});

test('a partly submitted report owes only the signals the reporter did not take', () => {
  const report = reported('2026-10', 'missing', ['free', 'beta', 'premium']);
  const notice = signalFailureNotice('2026-10');
  const partial = recordFailure(
    recordSignals(nothingRaised, report, {
      taken: report.signals.slice(0, 1),
      settled: false,
    }),
    '2026-10',
    notice,
  );
  assert({
    given:
      'a report whose first signal was taken before the reporter threw, and the signal failure reported',
    should:
      'owe the other two, hold the signal failure, and release it once they go through',
    actual: [
      plans(owedSignals(partial, report)),
      isFailureRaised(partial, '2026-10', notice),
      isFailureRaised(settle(partial, report), '2026-10', notice),
    ],
    expected: [['beta', 'premium'], true, false],
  });
});

test('a failure stays raised until a report settles, then is news again', () => {
  const report = reported('2026-10', 'missing', ['premium']);
  const failure = failed('2026-10', 'save_failed');
  const notice = failureNotice(failure);
  const failedOnce = recordFailure(
    settle(nothingRaised, report),
    '2026-10',
    notice,
  );
  const recovered = settle(failedOnce, report);
  assert({
    given:
      'a settled report, a reported failure, then the same report settling again',
    should: 'hold the failure while it persists and forget it after recovery',
    actual: [
      isFailureRaised(failedOnce, '2026-10', notice),
      isFailureRaised(recovered, '2026-10', notice),
    ],
    expected: [true, false],
  });
});

test('a new month starts afresh', () => {
  const october = reported('2026-10', 'missing', ['premium']);
  const november = reported('2026-11', 'missing', ['premium']);
  const raised = recordFeedMissingLogged(
    recordFailure(
      settle(nothingRaised, october),
      '2026-10',
      failureNotice(failed('2026-10', 'save_failed')),
    ),
    october,
  );
  assert({
    given: 'October settled, a failure and its feed logged as missing',
    should: 'owe November its signals and remember nothing of October',
    actual: [
      plans(owedSignals(raised, november)),
      raisedIn(raised, '2026-11').feedMissingLogged,
      raisedIn(raised, '2026-11').failures.size,
    ],
    expected: [['premium'], false, 0],
  });
});
