import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { ShellAccount } from '../../account';
import { Topbar } from './topbar';

setupRitewayBun();

const render = (account: ShellAccount) =>
  renderToString(h(Topbar, { account }));

describe('Topbar', () => {
  test('the brand on the left, the account on the right', () => {
    const html = render({ state: 'member', username: 'ada-byron' });
    assert({
      given: 'a signed-in member',
      should:
        'lead with the home brand, then the notifications and the account link',
      actual: [
        html.startsWith('<header'),
        html.indexOf('aria-label="Daisy Debate home"') <
          html.indexOf('href="/notifications"'),
        html.indexOf('href="/notifications"') <
          html.indexOf('aria-label="Account settings for ada-byron"'),
        html.includes('>ada-byron</span>'),
      ],
      expected: [true, true, true, true],
    });
  });

  test('a way in for anyone without a member account', () => {
    const visitor = render({ state: 'anonymous' });
    const provisional = render({ state: 'provisional' });
    assert({
      given: 'an anonymous visitor and an account mid sign-up',
      should:
        'offer Sign in or Finish sign-up where the account would be, and no notifications',
      actual: [
        visitor.includes('href="/sign-in"'),
        visitor.includes('>Sign in</a>'),
        provisional.includes('href="/onboarding/username"'),
        provisional.includes('>Finish sign-up</a>'),
        visitor.includes('href="/notifications"'),
      ],
      expected: [true, true, true, true, false],
    });
  });
});
