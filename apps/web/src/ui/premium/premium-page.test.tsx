import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  renderAccessible,
  type AccessibleView,
} from '../../test-support/rendered/accessible';
import { PremiumPage } from './premium-page';
setupRitewayBun();

const hrefs = (view: AccessibleView) =>
  view.all('link').map((link) => link.getAttribute('href'));

test('public Premium terms say unlimited at $20 a month, with no counter', () => {
  const view = renderAccessible(<PremiumPage />);
  const text = view.textContent();
  assert({
    given: 'the public Premium page',
    should:
      'state the $20 price, unlimited AI use, the fair-use ceiling, lifetime free use and continuing authorized reads',
    actual: [
      'Premium · $20/month',
      'Get Premium · $20/month',
      'Unlimited bot Rounds.',
      'Unlimited casual AI judging.',
      'Round analysis whenever you ask.',
      'No counters to watch.',
      'Human debate stays free',
      'one bot Round, one AI-judged casual Round and one requested Round analysis, ever',
      'after Premium ends',
      'visibility rules',
    ].filter((line) => !text.includes(line)),
    expected: [],
  });
  assert({
    given: 'an informational pricing read',
    should:
      'send buying to billing and play to free play, with nothing to post, no count and no old price',
    actual: [
      hrefs(view).includes('/settings/billing'),
      hrefs(view).includes('/play'),
      text.includes('authorized to watch'),
      ['button', 'textbox', 'checkbox'].some((role) => view.count(role) > 0),
      /USD 10|Five bot debates|remaining/.test(text),
    ],
    expected: [true, true, true, false, false],
  });
});

test('Compare plans appears only once /pricing is open', () => {
  assert({
    given: 'the pricing page closed, then open',
    should: 'link to /pricing only when it is open',
    actual: [
      hrefs(renderAccessible(<PremiumPage />)).includes('/pricing'),
      hrefs(renderAccessible(<PremiumPage comparePlans />)).includes(
        '/pricing',
      ),
    ],
    expected: [false, true],
  });
});
