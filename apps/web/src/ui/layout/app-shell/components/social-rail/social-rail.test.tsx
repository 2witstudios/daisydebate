import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderInStore } from '../../../../test-support/render-in-store';
import type { ShellAccount } from '../../account';
import { SocialRail } from './social-rail';

setupRitewayBun();

const member: ShellAccount = { state: 'member', username: 'ada-byron' };
const render = (account: ShellAccount) =>
  renderInStore(h(SocialRail, { account }));

describe('SocialRail', () => {
  test('you first, then your friends', () => {
    const html = render(member);
    assert({
      given: 'a signed-in member',
      should:
        'render the rail with your account and notifications above the friends list',
      actual: [
        html.includes('id="social-rail"'),
        html.includes('aria-label="You and your friends"'),
        html.includes('aria-label="Account settings for ada-byron"'),
        html.includes('href="/notifications"'),
        html.indexOf('Account settings for ada-byron') <
          html.indexOf('>Friends'),
      ],
      expected: [true, true, true, true, true],
    });
  });

  test('both views are in the markup, each with its own control', () => {
    const html = render(member);
    assert({
      given: 'the rail before any script',
      should:
        'carry the open panel with a collapse button and the strip with an expand button',
      actual: [
        html.includes('social-full'),
        html.includes('social-strip'),
        /aria-label="Collapse friends"[^>]*aria-expanded="true"/.test(html),
        /aria-label="Expand friends"[^>]*aria-expanded="false"/.test(html),
        (html.match(/aria-controls="social-rail"/g) ?? []).length,
      ],
      expected: [true, true, true, true, 2],
    });
  });

  test('grouped, with what you can do', () => {
    const html = render(member);
    assert({
      given: 'the open panel',
      should:
        'list people by status with Watch and Challenge links, debating first',
      actual: [
        html.indexOf('>In a debate</h3>') < html.indexOf('>Online</h3>'),
        html.includes('href="/watch"'),
        html.includes('href="/play/room"'),
        html.includes('href="/profile/alex-chen"'),
      ],
      expected: [true, true, true, true],
    });
  });

  test('nothing for a visitor or someone mid sign-up', () => {
    assert({
      given: 'an anonymous visitor and a provisional account',
      should: 'render nothing',
      actual: [
        render({ state: 'anonymous' }),
        render({ state: 'provisional' }),
      ],
      expected: ['', ''],
    });
  });
});
