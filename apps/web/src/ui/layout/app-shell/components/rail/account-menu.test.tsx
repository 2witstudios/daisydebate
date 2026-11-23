import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { AccountMenu } from './account-menu';

setupRitewayBun();

describe('AccountMenu', () => {
  test('a member reaches support from their account menu', () => {
    const html = renderToString(
      h(AccountMenu, {
        account: {
          state: 'member',
          username: 'sam',
          displayName: null,
          photoId: null,
        },
        extended: true,
        ratings: null,
      }),
    );
    const help = html.indexOf('href="/help"');
    const support = html.indexOf('href="/support"');
    assert({
      given: 'a member’s account menu',
      should: 'list Contact support right after Help',
      actual: [
        support > help && help !== -1,
        /href="\/support"[^>]*>Contact support</.test(html),
        html.indexOf('href="/about"') > support,
      ],
      expected: [true, true, true],
    });
  });
});
