import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { EconomicsCollection } from './economics-collector';
import {
  economicsNotice,
  nothingRaised,
  raisedFor,
  recordRaised,
} from './economics-notice';
setupRitewayBun();

const failed = (
  month: string,
  reason: 'feed_unreadable' | 'save_failed',
): EconomicsCollection => ({
  kind: 'failed',
  month,
  reason,
  cause: new Error(`private ${reason}`),
});
const reported = (
  month: string,
  feed: 'supplied' | 'missing',
  plans: readonly ('free' | 'beta' | 'premium')[],
) =>
  ({
    kind: 'reported',
    month,
    feed,
    report: { kind: 'invalid', reason: 'invalid_input' },
    signals: plans.map((plan) => ({
      name: 'BILLING_ECONOMICS_INCOMPLETE' as const,
      plan,
    })),
  }) as const;
const settled = { owed: [], failureReported: false };
const reportedFailure = { owed: [], failureReported: true };

test('the same outcome for the same month is one notice', () => {
  assert({
    given:
      'two failures of one month for one reason, with distinct caught errors',
    should: 'share one notice, so the worker raises it once',
    actual:
      economicsNotice(failed('2026-10', 'save_failed')) ===
      economicsNotice(failed('2026-10', 'save_failed')),
    expected: true,
  });
  assert({
    given: 'two reports of one month with the same feed state and signals',
    should: 'share one notice',
    actual:
      economicsNotice(reported('2026-10', 'missing', ['free', 'premium'])) ===
      economicsNotice(reported('2026-10', 'missing', ['free', 'premium'])),
    expected: true,
  });
});

test('a changed outcome or a new month is a new notice', () => {
  const base = economicsNotice(reported('2026-10', 'missing', ['premium']));
  assert({
    given:
      'a new month, a supplied feed, other signals, or a failure after a report',
    should: 'each be a distinct notice from the original outcome',
    actual: [
      economicsNotice(reported('2026-11', 'missing', ['premium'])),
      economicsNotice(reported('2026-10', 'supplied', ['premium'])),
      economicsNotice(reported('2026-10', 'missing', ['free', 'premium'])),
      economicsNotice(failed('2026-10', 'feed_unreadable')),
    ].map((notice) => notice !== base),
    expected: [true, true, true, true],
  });
});

test('a report is raised once a month, even after a failure in between', () => {
  const report = reported('2026-10', 'missing', ['free', 'beta', 'premium']);
  const failure = failed('2026-10', 'feed_unreadable');
  const raised = recordRaised(
    recordRaised(nothingRaised, report, settled),
    failure,
    reportedFailure,
  );
  assert({
    given: 'a settled report, then a reported failure in the same month',
    should: 'keep the report settled and the failure reported',
    actual: [
      raisedFor(raised, report)?.owed,
      raisedFor(raised, failure)?.failureReported,
    ],
    expected: [[], true],
  });
});

test('a failure is news again once a report settles after it', () => {
  const report = reported('2026-10', 'missing', ['premium']);
  const failure = failed('2026-10', 'save_failed');
  const recovered = recordRaised(
    recordRaised(nothingRaised, failure, reportedFailure),
    report,
    settled,
  );
  assert({
    given: 'a reported failure, then a report that settles',
    should: 'forget the failure, so a regression after recovery is raised',
    actual: raisedFor(recovered, failure),
    expected: undefined,
  });
});

test('a partly submitted report still owes its unsent signals', () => {
  const report = reported('2026-10', 'missing', ['free', 'beta', 'premium']);
  const failure = failed('2026-10', 'feed_unreadable');
  const partial = recordRaised(
    recordRaised(nothingRaised, failure, reportedFailure),
    report,
    { owed: report.signals.slice(1), failureReported: true },
  );
  assert({
    given:
      'a report whose first signal was submitted before the reporter threw',
    should:
      'owe the other two and keep the earlier failure, since nothing settled',
    actual: [
      raisedFor(partial, report)?.owed.map((s) => s.plan),
      raisedFor(partial, failure)?.failureReported,
    ],
    expected: [['beta', 'premium'], true],
  });
});

test('a new month starts afresh', () => {
  const october = reported('2026-10', 'missing', ['premium']);
  const november = reported('2026-11', 'missing', ['premium']);
  const raised = recordRaised(
    recordRaised(nothingRaised, october, settled),
    november,
    settled,
  );
  assert({
    given: 'October settled, then November recorded',
    should: 'remember only November',
    actual: [raisedFor(raised, october), raised.notices.size],
    expected: [undefined, 1],
  });
});
