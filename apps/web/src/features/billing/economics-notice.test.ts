import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  isRaised,
  nothingRaised,
  owedSignals,
  recordRaised,
  recordReport,
} from './economics-notice';
import { buildEconomicsReport } from './economics-report';
import { dataset, now } from './economics.test-support';
setupRitewayBun();

const built = buildEconomicsReport(dataset(), now);
if (built.kind !== 'report') throw Error('Expected a valid report');
const validReport = built;

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
  raised: Parameters<typeof recordReport>[0],
  report: ReturnType<typeof reported>,
) =>
  recordReport(raised, report, {
    taken: owedSignals(raised, report),
    settled: true,
  });
const plans = (signals: readonly { readonly plan: string }[]) =>
  signals.map((s) => s.plan);

test('a reason stays raised for its streak and is news again after a settled report', () => {
  const report = reported('2026-10', 'supplied', ['premium']);
  const failing = recordRaised(nothingRaised, '2026-10', 'save_failed');
  const unsettled = recordReport(failing, report, {
    taken: [],
    settled: false,
  });
  assert({
    given:
      'a raised save failure, then a saved report whose signals failed, then one that settled',
    should: 'hold the failure until the report settles, then release it',
    actual: [
      isRaised(failing, '2026-10', 'save_failed'),
      isRaised(failing, '2026-10', 'feed_invalid'),
      isRaised(unsettled, '2026-10', 'save_failed'),
      isRaised(settle(unsettled, report), '2026-10', 'save_failed'),
    ],
    expected: [true, false, true, false],
  });
});

test('a missing feed stays raised across settled reports until a feed is supplied', () => {
  const missing = reported('2026-10', 'missing', ['premium']);
  const logged = settle(
    recordRaised(nothingRaised, '2026-10', 'feed_missing'),
    missing,
  );
  assert({
    given: 'a logged missing feed and a settled missing-feed report',
    should: 'keep feed_missing raised, then release it once a feed is supplied',
    actual: [
      isRaised(logged, '2026-10', 'feed_missing'),
      isRaised(
        settle(logged, reported('2026-10', 'supplied', ['premium'])),
        '2026-10',
        'feed_missing',
      ),
    ],
    expected: [true, false],
  });
});

test('each signal is raised once a month, and a partial submission owes only the rest', () => {
  const report = reported('2026-10', 'missing', ['free', 'beta', 'premium']);
  const partial = recordReport(nothingRaised, report, {
    taken: report.signals.slice(0, 1),
    settled: false,
  });
  assert({
    given:
      'a report whose first signal was taken before the reporter threw, then the month settled',
    should: 'owe the other two, then nothing more',
    actual: [
      plans(owedSignals(partial, report)),
      plans(owedSignals(settle(partial, report), report)),
    ],
    expected: [['beta', 'premium'], []],
  });
});

test('a new month starts afresh', () => {
  const october = recordRaised(
    settle(nothingRaised, reported('2026-10', 'missing', ['premium'])),
    '2026-10',
    'save_failed',
  );
  const november = reported('2026-11', 'missing', ['premium']);
  assert({
    given: 'October settled and then failing',
    should: 'owe November its signals and hold none of October’s reasons',
    actual: [
      plans(owedSignals(october, november)),
      isRaised(october, '2026-11', 'save_failed'),
    ],
    expected: [['premium'], false],
  });
});
