import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { AppShell } from './app-shell';
import type { ShellAccount } from './account';
import { occurrences, renderInStore } from '../../test-support/render-in-store';

setupRitewayBun();

const member: ShellAccount = { state: 'member', username: 'ada-byron' };

const render = (account: ShellAccount = { state: 'anonymous' }): string =>
  renderInStore(h(AppShell, { account, children: h('p', null, 'page') }));

describe('AppShell', () => {
  test('owns the single main landmark, with no topbar', () => {
    const html = render();
    const signedIn = render(member);
    assert({
      given:
        'the shell for a visitor and a member, with the root layout rendering no landmark of its own',
      should:
        "render one main and one primary nav, no topbar, and one aside: the account corner or the member's rail",
      actual: [
        occurrences(html, '<main'),
        occurrences(html, '<nav'),
        occurrences(html, '<header'),
        occurrences(html, '<aside'),
        occurrences(signedIn, '<aside'),
        signedIn.indexOf('<header') > signedIn.indexOf('<aside'),
      ],
      expected: [1, 1, 0, 1, 1, true],
    });
  });

  test('names its landmarks', () => {
    const html = render();
    assert({
      given: 'the shell landmarks',
      should: 'label the navigation "Primary"',
      actual: /<nav[^>]* aria-label="Primary"/.test(html),
      expected: true,
    });
  });

  test('places the page in the content column, with no topic banner', () => {
    const html = render();
    const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
    assert({
      given: 'page content',
      should: "render the page inside main and no today's topic anywhere",
      actual: [
        main.includes('<p>page</p>'),
        html.includes('Today&#x27;s topic') || html.includes('Today’s topic'),
        html.includes('Join the discussion'),
      ],
      expected: [true, false, false],
    });
  });

  test('has no right column any more', () => {
    const html = render();
    assert({
      given: 'the shell',
      should: 'carry no community rail',
      actual: html.includes('aria-label="Community"'),
      expected: false,
    });
  });

  test('the account sits top right: the rail for a member, Sign in for a visitor', () => {
    const visitor = render();
    const signedIn = render(member);
    assert({
      given: 'a visitor and a member',
      should:
        'give the member the rail with their account, and the visitor Sign in in the account corner, not the sidebar',
      actual: [
        visitor.includes('id="social-rail"'),
        signedIn.includes('id="social-rail"'),
        /<aside[^>]*aria-label="Account"[^>]*>.*href="\/sign-in"/.test(visitor),
        visitor.indexOf('href="/sign-in"') > visitor.indexOf('</nav>'),
        signedIn.includes('href="/sign-in"'),
        signedIn.includes('aria-label="Account settings for ada-byron"'),
      ],
      expected: [false, true, true, true, false, true],
    });
  });

  test('the grid carries the dock state for the layout', () => {
    assert({
      given: 'a visitor and a member',
      should:
        'mark the visitor as railless, and follow the screen (auto) for the rail and the sidebar',
      actual: [
        render().includes('data-dock="none"'),
        render(member).includes('data-dock="auto"'),
        render(member).includes('data-nav="auto"'),
      ],
      expected: [true, true, true],
    });
  });
});
