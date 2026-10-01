import { join } from 'node:path';
import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { Sidebar } from './sidebar';
import type { ShellAccount } from '../topbar/topbar';
import { routeExists } from '../../../../test-support/route-exists';

setupRitewayBun();

const member: ShellAccount = { state: 'member', username: 'ada-byron' };

const appDirectory = join(import.meta.dir, '../../../../../app');

describe('Sidebar', () => {
  test('is the primary navigation landmark', () => {
    const html = renderToString(h(Sidebar, { account: member }));
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
    const html = renderToString(h(Sidebar, { account: member }));
    const hrefs = [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map(
      (match) => match[1] ?? '',
    );
    assert({
      given: 'every link in the sidebar, flyouts included',
      should: 'cover the core destinations and resolve to an app router page',
      actual: [
        ['/', '/ranked', '/lobby', '/judge', '/recordings', '/settings'].filter(
          (href) => !hrefs.includes(href),
        ),
        hrefs.filter((href) => !routeExists(appDirectory, href)),
      ],
      expected: [[], []],
    });
  });

  test('derives the Profile link from the signed-in account', () => {
    const anonymousHtml = renderToString(
      h(Sidebar, { account: { state: 'anonymous' } }),
    );
    const memberHtml = renderToString(h(Sidebar, { account: member }));
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

  test('lists Ranked with Play and Lobby, and Judge after Watch', () => {
    const html = renderToString(h(Sidebar, { account: member }));
    const hrefs = [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map(
      (match) => match[1] ?? '',
    );
    const at = (href: string) => hrefs.indexOf(href);
    assert({
      given: 'the sidebar',
      should:
        'order Play, Ranked, Lobby together, and place Judge between Watch and Train',
      actual: [
        at('/play') < at('/ranked') && at('/ranked') < at('/lobby'),
        at('/watch') < at('/judge') && at('/judge') < at('/train'),
      ],
      expected: [true, true],
    });
  });
});
