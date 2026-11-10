import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAppError, createRefusal } from '@daisy/errors';
import type { BillingEconomicsRefusal } from '@daisy/protocol/billing-economics';
import {
  collectCompleted,
  isCollectRaised,
  recordCollect,
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
    code: 'INTERNAL',
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
    code: 'INFRASTRUCTURE' as const,
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
      '2026-10:save_failed:INTERNAL:/Error/',
      '2026-10:save_failed:INFRASTRUCTURE:/',
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
    '2026-10',
    true,
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

test('each distinct data defect in a stage is its own notice', () => {
  const defect = (check: BillingEconomicsRefusal) => ({
    ...failed('2026-10', 'save_failed'),
    reason: 'feed_invalid' as const,
    code: 'VALIDATION' as const,
    cause: createRefusal('VALIDATION', check, 'the same words for both'),
  });
  assert({
    given:
      'two VALIDATION refusals of the feed with different reasons and identical messages',
    should: 'be distinct notices, so fixing one and breaking another is news',
    actual:
      failureNotice(defect('economics-feed-window-mismatch')) !==
      failureNotice(defect('economics-feed-duplicate-capacity')),
    expected: true,
  });
});

test('a saved report re-arms stage failures even when its signals did not go through', () => {
  const report = reported('2026-10', 'missing', ['premium']);
  const stage = failureNotice(failed('2026-10', 'save_failed'));
  const signal = signalFailureNotice('2026-10');
  const raised = recordSignals(
    recordFailure(
      recordFailure(nothingRaised, '2026-10', stage),
      '2026-10',
      signal,
    ),
    report,
    { taken: [], settled: false },
  );
  assert({
    given:
      'a raised stage failure and a raised signal failure, then a saved report whose signals failed',
    should: 'forget the stage failure and keep the signal failure',
    actual: [
      isFailureRaised(raised, '2026-10', stage),
      isFailureRaised(raised, '2026-10', signal),
    ],
    expected: [false, true],
  });
});

test('two typed problems in one stage are two notices', () => {
  const sink = (check: BillingEconomicsRefusal, message: string) => ({
    ...failed('2026-10', 'save_failed'),
    reason: 'sink_unavailable' as const,
    code: 'INFRASTRUCTURE' as const,
    cause: createRefusal('INFRASTRUCTURE', check, message),
  });
  assert({
    given:
      'a sink stage refused first for privacy and later for capacity, both typed',
    should: 'give each problem its own notice',
    actual:
      failureNotice(sink('economics-sink-not-private', 'a')) !==
      failureNotice(sink('economics-sink-full', 'a')),
    expected: true,
  });
});

test('untyped failures differ by their class and system code, never their text', () => {
  const untyped = (message: string, code?: string) => ({
    ...failed('2026-10', 'save_failed'),
    reason: 'snapshot_failed' as const,
    code: 'INFRASTRUCTURE' as const,
    cause: Object.assign(new Error(message), code ? { code } : {}),
  });
  assert({
    given:
      'a refused connection, a missing relation, and the refused connection again with other text',
    should:
      'make the two system codes distinct notices and the repeat the same notice',
    actual: [
      failureNotice(
        untyped('connect ECONNREFUSED 10.0.0.1', 'ECONNREFUSED'),
      ) === failureNotice(untyped('relation does not exist', '42P01')),
      failureNotice(
        untyped('connect ECONNREFUSED 10.0.0.1', 'ECONNREFUSED'),
      ) ===
        failureNotice(untyped('connect ECONNREFUSED 10.0.0.2', 'ECONNREFUSED')),
    ],
    expected: [false, true],
  });
});

test('a reworded message never changes a notice', () => {
  const check = (message: string) => ({
    ...failed('2026-10', 'save_failed'),
    reason: 'feed_invalid' as const,
    code: 'VALIDATION' as const,
    cause: createRefusal(
      'VALIDATION',
      'economics-feed-window-mismatch',
      message,
    ),
  });
  assert({
    given: 'the same refusal reason with two different messages',
    should: 'be one notice (ADR 0102: no behaviour reads a message)',
    actual:
      failureNotice(check('Economics feed window mismatch')) ===
      failureNotice(check('The feed is for another month')),
    expected: true,
  });
});

test('a typed refusal wrapping different system errors gives different notices', () => {
  const open = (errno: string) => ({
    ...failed('2026-10', 'save_failed'),
    reason: 'feed_unreadable' as const,
    code: 'INFRASTRUCTURE' as const,
    cause: createRefusal(
      'INFRASTRUCTURE',
      'economics-feed-unavailable',
      undefined,
      Object.assign(new Error(errno), { code: errno }),
    ),
  });
  assert({
    given: 'the feed open refused with EMFILE, then with EIO',
    should: 'be two notices, keyed on the wrapped errno',
    actual: failureNotice(open('EMFILE')) === failureNotice(open('EIO')),
    expected: false,
  });
});

test('collect notices survive a month change and clear when a collection completes', () => {
  const october = reported('2026-10', 'missing', ['premium']);
  const notice = 'collect:INTERNAL:economics-clock-invalid/';
  const failedOutside = recordCollect(settle(nothingRaised, october), notice);
  const nextMonth = raisedIn(failedOutside, '2026-11');
  assert({
    given:
      'a collect failure raised in October, then the record read for November',
    should:
      'keep the collect notice across the month change, then clear it on completion',
    actual: [
      isCollectRaised(nextMonth, notice),
      isCollectRaised(collectCompleted(nextMonth), notice),
      nextMonth.signals.size,
    ],
    expected: [true, false, 0],
  });
});

test('a lock timeout and a statement timeout are different database problems', () => {
  const sqlstate = (errno: string) => ({
    ...failed('2026-10', 'save_failed'),
    reason: 'snapshot_failed' as const,
    code: 'INFRASTRUCTURE' as const,
    cause: Object.assign(new Error('server error'), {
      name: 'PostgresError',
      code: 'ERR_POSTGRES_SERVER_ERROR',
      errno,
    }),
  });
  assert({
    given: 'two Bun SQL server errors with SQLSTATE 55P03 and 57014 in errno',
    should: 'be two notices',
    actual:
      failureNotice(sqlstate('55P03')) === failureNotice(sqlstate('57014')),
    expected: false,
  });
});

test('a nested refusal is keyed by its innermost reason, as the log names it', () => {
  const reader = (inner: BillingEconomicsRefusal) => ({
    ...failed('2026-10', 'save_failed'),
    reason: 'feed_unreadable' as const,
    code: 'INFRASTRUCTURE' as const,
    cause: createRefusal(
      'INFRASTRUCTURE',
      'economics-sink-unreadable',
      undefined,
      createRefusal('VALIDATION', inner),
    ),
  });
  assert({
    given:
      'the feed reader refusal wrapping first a privacy fault, then an ownership fault',
    should: 'be two notices',
    actual:
      failureNotice(reader('economics-sink-not-private')) ===
      failureNotice(reader('economics-sink-unusable')),
    expected: false,
  });
});
