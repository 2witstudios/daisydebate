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
  test('owns the single main landmark, under one top bar', () => {
    const html = render();
    const signedIn = render(member);
    assert({
      given:
        'the shell for a visitor and a member, with the root layout rendering no landmark of its own',
      should:
        'render the top bar first, then one primary nav and one main, and the friends rail only for the member',
      actual: [
        occurrences(html, '<header'),
        html.indexOf('<header') < html.indexOf('<nav'),
        occurrences(html, '<nav'),
        occurrences(html, '<main'),
        occurrences(html, '<aside'),
        occurrences(signedIn, '<aside'),
      ],
      expected: [1, true, 1, 1, 0, 1],
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

  test('the brand and the account live in the top bar, outside the columns', () => {
    const visitor = render();
    const signedIn = render(member);
    const bar = (html: string) =>
      html.slice(html.indexOf('<header'), html.indexOf('</header>'));
    assert({
      given: 'a visitor and a member',
      should:
        'put the brand and the way in or the account in the top bar, and the friends rail only for the member',
      actual: [
        bar(visitor).includes('aria-label="Daisy Debate home"'),
        bar(visitor).includes('href="/sign-in"'),
        bar(signedIn).includes('aria-label="Account settings for ada-byron"'),
        bar(signedIn).includes('href="/notifications"'),
        visitor.includes('id="social-rail"'),
        signedIn.includes('id="social-rail"'),
      ],
      expected: [true, true, true, true, false, true],
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
