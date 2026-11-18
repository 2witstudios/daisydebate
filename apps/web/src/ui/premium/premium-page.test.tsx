import { assert, setupRitewayBun, test } from 'riteway/bun';
import { renderToStaticMarkup } from 'react-dom/server';
import { PremiumPage } from './premium-page';
setupRitewayBun();

test('public Premium terms say unlimited at $20 a month, with no counter', () => {
  const html = renderToStaticMarkup(<PremiumPage />);
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
    ].filter((text) => !html.includes(text)),
    expected: [],
  });
  assert({
    given: 'an informational pricing read',
    should:
      'send buying to billing and play to free play, with no form, no count and no old price',
    actual: [
      html.includes('href="/settings/billing"'),
      html.includes('href="/play"'),
      html.includes('authorized to watch'),
      html.includes('<form'),
      /USD 10|Five bot debates|remaining/.test(html),
    ],
    expected: [true, true, true, false, false],
  });
});

test('Compare plans appears only once /pricing is open', () => {
  assert({
    given: 'the pricing page closed, then open',
    should: 'link to /pricing only when it is open',
    actual: [
      renderToStaticMarkup(<PremiumPage />).includes('href="/pricing"'),
      renderToStaticMarkup(<PremiumPage comparePlans />).includes(
        'href="/pricing"',
      ),
    ],
    expected: [false, true],
  });
});
