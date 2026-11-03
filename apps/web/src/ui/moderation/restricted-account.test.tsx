import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { RestrictedAccount } from './restricted-account';

setupRitewayBun();

test('a failed sign-out comes back to the restricted page (ADR 0103)', () => {
  const html = renderToString(
    h(RestrictedAccount, {
      username: 'ada',
      until: null,
      signOutFailed: false,
    }),
  );
  assert({
    given: 'the restricted page',
    should: 'send its sign-out form back here, not to the beta page',
    actual: [html.includes('value="/restricted"'), html.includes('/beta')],
    expected: [true, false],
  });
});
