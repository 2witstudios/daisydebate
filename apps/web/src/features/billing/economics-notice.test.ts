import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  economicsNotice,
  isFailureRaised,
  nothingRaised,
  recordFailure,
  recordReport,
  reportProgress,
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
const settled = { owed: [], signalFailureReported: false };

test('the same outcome for the same month is one notice', () => {
  assert({
    given:
      'two failures of one month for one reason, with distinct caught errors',
    should: 'share one notice, so the worker raises it once',
    actual: economicsNotice(failed('2026-10', 'save_failed')),
    expected: economicsNotice(failed('2026-10', 'save_failed')),
  });
  assert({
    given: 'two reports of one month with the same feed state and signals',
    should: 'share one notice',
    actual: economicsNotice(
      reported('2026-10', 'missing', ['free', 'premium']),
    ),
    expected: economicsNotice(
      reported('2026-10', 'missing', ['free', 'premium']),
    ),
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
  const raised = recordFailure(
    recordReport(nothingRaised, report, settled),
    failure,
  );
  assert({
    given: 'a settled report, then a reported failure in the same month',
    should: 'keep the report settled and the failure raised',
    actual: [
      reportProgress(raised, report)?.owed,
      isFailureRaised(raised, failure),
    ],
    expected: [[], true],
  });
});

test("every settled report re-arms the month's failures", () => {
  const report = reported('2026-10', 'missing', ['premium']);
  const failure = failed('2026-10', 'save_failed');
  const once = recordReport(
    recordFailure(nothingRaised, failure),
    report,
    settled,
  );
  const again = recordReport(recordFailure(once, failure), report, settled);
  assert({
    given:
      'a failure then a settling report, and the same failure then the same report again',
    should: 'forget the failure both times, so each regression is raised',
    actual: [isFailureRaised(once, failure), isFailureRaised(again, failure)],
    expected: [false, false],
  });
});

test('a partly submitted report still owes its unsent signals', () => {
  const report = reported('2026-10', 'missing', ['free', 'beta', 'premium']);
  const failure = failed('2026-10', 'feed_unreadable');
  const partial = recordReport(recordFailure(nothingRaised, failure), report, {
    owed: report.signals.slice(1),
    signalFailureReported: true,
  });
  assert({
    given:
      'a report whose first signal was submitted before the reporter threw',
    should:
      'owe the other two and keep the earlier failure, since nothing settled',
    actual: [
      reportProgress(partial, report)?.owed.map((s) => s.plan),
      reportProgress(partial, report)?.signalFailureReported,
      isFailureRaised(partial, failure),
    ],
    expected: [['beta', 'premium'], true, true],
  });
});

test('a new month starts afresh', () => {
  const october = reported('2026-10', 'missing', ['premium']);
  const failure = failed('2026-10', 'save_failed');
  const november = reported('2026-11', 'missing', ['premium']);
  const raised = recordReport(
    recordFailure(recordReport(nothingRaised, october, settled), failure),
    november,
    { owed: november.signals, signalFailureReported: true },
  );
  assert({
    given: 'October settled with a failure, then November partly raised',
    should: 'remember only November',
    actual: [
      reportProgress(raised, october),
      isFailureRaised(raised, failure),
      raised.reports.size,
    ],
    expected: [undefined, false, 1],
  });
});
