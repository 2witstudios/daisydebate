import { createElement as h } from 'react';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../test-support/rendered/accessible';
import { RestrictedAccount } from './restricted-account';

setupRitewayBun();

test('a failed sign-out comes back to the restricted page (ADR 0103)', () => {
  const view = renderAccessible(
    h(RestrictedAccount, {
      username: 'ada',
      until: null,
      signOutFailed: false,
    }),
  );
  const next = view
    .get('button', 'Sign out')
    .closest('form')
    ?.querySelector('input[name="next"]')
    ?.getAttribute('value');
  assert({
    given: 'the restricted page',
    should: 'send its sign-out form back here, not to the beta page',
    actual: [
      next,
      view
        .all('link')
        .some((link) => link.getAttribute('href')?.includes('/beta')),
    ],
    expected: ['/restricted', false],
  });
});
