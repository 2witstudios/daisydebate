import { assert, setupRitewayBun, test } from 'riteway/bun';
import { economicsNotice } from './economics-notice';
setupRitewayBun();

const failed = (month: string, reason: 'feed_unreadable' | 'save_failed') => ({
  kind: 'failed' as const,
  month,
  reason,
  cause: new Error(`private ${reason}`),
});
const reported = (
  month: string,
  feed: 'supplied' | 'missing',
  plans: readonly ('free' | 'beta' | 'premium')[],
) => ({
  kind: 'reported' as const,
  month,
  feed,
  signals: plans.map((plan) => ({
    name: 'BILLING_ECONOMICS_INCOMPLETE' as const,
    plan,
  })),
});

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
      'a new month, another failure reason, a supplied feed, other signals, or a failure after a report',
    should: 'each be a distinct notice from the original outcome',
    actual: [
      economicsNotice(reported('2026-11', 'missing', ['premium'])),
      economicsNotice(reported('2026-10', 'supplied', ['premium'])),
      economicsNotice(reported('2026-10', 'missing', ['free', 'premium'])),
      economicsNotice(failed('2026-10', 'feed_unreadable')),
    ].map((notice) => notice !== base),
    expected: [true, true, true, true],
  });
  assert({
    given: 'two failure reasons in one month',
    should: 'be distinct notices',
    actual:
      economicsNotice(failed('2026-10', 'feed_unreadable')) ===
      economicsNotice(failed('2026-10', 'save_failed')),
    expected: false,
  });
});
