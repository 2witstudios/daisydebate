import { assert, setupRitewayBun, test } from 'riteway/bun';
import { renderToStaticMarkup } from 'react-dom/server';
import { PremiumPage } from './premium-page';
setupRitewayBun();

test('public pricing explains the period and lifetime allowances without implying paid human play or private access', () => {
  const html = renderToStaticMarkup(<PremiumPage />);
  assert({
    given: 'the public Premium page',
    should:
      'state the confirmed price, paid period, lifetime free use and continuing authorized reads',
    actual: [
      'USD 10/month',
      'Five bot debates per billing period',
      'Unlimited casual AI judging',
      'Human debate stays free',
      'do not reset each month',
      'after Premium ends',
      'visibility rules',
    ].filter((text) => !html.includes(text)),
    expected: [],
  });
  assert({
    given: 'an informational pricing read',
    should:
      'link to free play without admitting a purchase or claiming private content access',
    actual: [
      html.includes('href="/play"'),
      html.includes('authorized to watch'),
      html.includes('<form'),
    ],
    expected: [true, true, false],
  });
});
