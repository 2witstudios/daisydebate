import { join } from 'node:path';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { Sidebar } from './sidebar';
import type { ShellAccount } from '../../account';
import { renderInStore } from '../../../../test-support/render-in-store';
import { routeExists } from '../../../../test-support/route-exists';

setupRitewayBun();

const member: ShellAccount = { state: 'member', username: 'ada-byron' };

const appDirectory = join(import.meta.dir, '../../../../../app');

describe('Sidebar', () => {
  test('is the primary navigation landmark', () => {
    const html = renderInStore(h(Sidebar, { account: member }));
    assert({
      given: 'the sidebar',
      should: 'render exactly one nav, named "Primary"',
      actual: [
        /^<nav[^>]* aria-label="Primary"/.test(html),
        html.split('<nav').length - 1,
      ],
      expected: [true, 1],
    });
  });

  test('links only to routes that exist', () => {
    const html = renderInStore(h(Sidebar, { account: member }));
    const hrefs = [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map(
      (match) => match[1] ?? '',
    );
    assert({
      given: 'every link in the sidebar, flyouts included',
      should: 'cover the core destinations and resolve to an app router page',
      actual: [
        ['/', '/play', '/judge', '/recordings', '/settings'].filter(
          (href) => !hrefs.includes(href),
        ),
        hrefs.filter((href) => !routeExists(appDirectory, href)),
      ],
      expected: [[], []],
    });
  });

  test('the brand on top, a way in and the collapse control at the foot', () => {
    const visitor = renderInStore(
      h(Sidebar, { account: { state: 'anonymous' } }),
    );
    const provisional = renderInStore(
      h(Sidebar, { account: { state: 'provisional' } }),
    );
    const signedIn = renderInStore(h(Sidebar, { account: member }));
    const at = (html: string, needle: string) => html.indexOf(needle);
    assert({
      given: 'a visitor, an account mid sign-up and a member',
      should:
        'lead with the home brand, then the links, then the way in and the collapse button',
      actual: [
        at(visitor, 'aria-label="Daisy Debate home"') >= 0 &&
          at(visitor, 'aria-label="Daisy Debate home"') <
            at(visitor, 'href="/play"'),
        at(visitor, 'href="/play"') < at(visitor, 'href="/sign-in"'),
        at(visitor, 'href="/sign-in"') <
          at(visitor, 'aria-label="Collapse sidebar"'),
        provisional.includes('href="/onboarding/username"'),
        signedIn.includes('href="/sign-in"'),
        signedIn.includes('aria-label="Collapse sidebar"'),
      ],
      expected: [true, true, true, true, false, true],
    });
  });

  test('derives the Profile link from the signed-in account', () => {
    const anonymousHtml = renderInStore(
      h(Sidebar, { account: { state: 'anonymous' } }),
    );
    const memberHtml = renderInStore(h(Sidebar, { account: member }));
    assert({
      given: 'an anonymous visitor and a signed-in member',
      should:
        'omit the Profile link for the visitor and derive it from the username for the member',
      actual: [
        anonymousHtml.includes('/profile/'),
        memberHtml.includes('href="/profile/ada-byron"'),
      ],
      expected: [false, true],
    });
  });

  test('lists Play as one item, and Judge after Watch', () => {
    const html = renderInStore(h(Sidebar, { account: member }));
    const hrefs = [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map(
      (match) => match[1] ?? '',
    );
    const at = (href: string) => hrefs.indexOf(href);
    assert({
      given: 'the sidebar',
      should:
        'have Play as a gateway with no flyout, and place Judge between Watch and Train',
      actual: [
        at('/play') >= 0 && at('/ranked') === -1 && at('/lobby') === -1,
        at('/watch') < at('/judge') && at('/judge') < at('/train'),
      ],
      expected: [true, true],
    });
  });
});
