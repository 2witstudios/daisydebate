import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { AppShell } from './app-shell';
import type { ShellAccount } from './components/topbar/topbar';
import { occurrences, renderInStore } from '../../test-support/render-in-store';

setupRitewayBun();

const member: ShellAccount = { state: 'member', username: 'ada-byron' };

const render = (account: ShellAccount = { state: 'anonymous' }): string =>
  renderInStore(h(AppShell, { account, children: h('p', null, 'page') }));

describe('AppShell', () => {
  test('owns the single main landmark, as a sibling of header and nav', () => {
    const html = render();
    assert({
      given:
        'the shell for a visitor, with the root layout rendering no landmark of its own',
      should:
        'render exactly one main, one banner, one primary nav and no aside',
      actual: [
        occurrences(html, '<main'),
        occurrences(html, '<header'),
        occurrences(html, '<nav'),
        occurrences(html, '<aside'),
      ],
      expected: [1, 1, 1, 0],
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

  test('the friends dock is for members only, with a toggle in the topbar', () => {
    const visitor = render();
    const signedIn = render(member);
    assert({
      given: 'a visitor and a member',
      should:
        'give the member the column and the topbar toggle, and the visitor neither',
      actual: [
        visitor.includes('id="friends-dock"'),
        signedIn.includes('id="friends-dock"'),
        visitor.includes('aria-controls="friends-dock"'),
        signedIn.includes('aria-controls="friends-dock"'),
      ],
      expected: [false, true, false, true],
    });
  });

  test('the grid carries the dock state for the layout', () => {
    assert({
      given: 'a visitor and a member',
      should:
        'reserve no column for a visitor, and follow the screen (auto) for a member',
      actual: [
        render().includes('data-dock="closed"'),
        render(member).includes('data-dock="auto"'),
        render().includes('data-nav="auto"'),
      ],
      expected: [true, true, true],
    });
  });
});
