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
  test('your friends, with your account left to the top bar', () => {
    const html = render(member);
    assert({
      given: 'a signed-in member',
      should: 'render the friends rail without the account or notifications',
      actual: [
        html.includes('id="social-rail"'),
        html.includes('aria-label="Friends"'),
        html.includes('>Friends'),
        html.includes('Account settings for'),
        html.includes('href="/notifications"'),
      ],
      expected: [true, true, true, false, false],
    });
  });

  test('both views are in the markup, each with its own control', () => {
    const html = render(member);
    assert({
      given: 'the rail before any script',
      should:
        'carry the open panel with a collapse tab and the strip with an expand tab, each ahead of its friends',
      actual: [
        html.includes('social-full'),
        html.includes('social-strip'),
        /aria-label="Collapse friends"[^>]*aria-expanded="true"/.test(html),
        /aria-label="Expand friends"[^>]*aria-expanded="false"/.test(html),
        (html.match(/aria-controls="social-rail"/g) ?? []).length,
        html.indexOf('aria-label="Collapse friends"') <
          html.indexOf('>Friends'),
        html.indexOf('aria-label="Expand friends"') <
          html.indexOf(' on</span>'),
      ],
      expected: [true, true, true, true, 2, true, true],
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
      should: 'render no rail: their way in is in the top bar',
      actual: [
        render({ state: 'anonymous' }),
        render({ state: 'provisional' }),
      ],
      expected: ['', ''],
    });
  });
});
