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
      'Record your casual Rounds.',
      'study them and improve',
      'Unlimited casual AI judging.',
      'Round analysis whenever you ask.',
      'No counters to watch.',
      'Human debate stays free',
      'one requested Round analysis, ever',
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
      /USD 10|Five bot debates|remaining|\bbots?\b/i.test(text),
    ],
    expected: [true, true, true, false, false],
  });
});

test('recording casual Rounds leads the offer, ahead of everything else it includes', () => {
  const text = renderAccessible(<PremiumPage />).textContent();
  const at = (line: string) => text.indexOf(line);
  assert({
    given: 'the Premium offer',
    should: 'state recording first, then analysis, AI judging and downloads',
    actual: [
      at('Record your casual Rounds.') >= 0,
      at('Record your casual Rounds.') < at('Round analysis whenever you ask.'),
      at('Record your casual Rounds.') < at('Unlimited casual AI judging.'),
      at('Record your casual Rounds.') < at('Download Recordings'),
    ],
    expected: [true, true, true, true],
  });
});

test('a viewer who already has Premium is told so and is not offered it', () => {
  const view = renderAccessible(<PremiumPage holdsPremium />);
  const text = view.textContent();
  assert({
    given: 'a viewer whose current plan is Premium',
    should:
      'say they have Premium, send them to billing to manage it, keep the terms, and show no Get Premium',
    actual: [
      text.includes('You have Premium.'),
      text.includes('Get Premium'),
      view.attribute('link', 'Manage billing', 'href'),
      text.includes('Record your casual Rounds.'),
    ],
    expected: [true, false, '/settings/billing', true],
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
