import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderMarkup } from '../test-support/rendered/markup';
import { AppShell } from '../ui/layout/app-shell/app-shell';
import type { ShellAccount } from '../ui/layout/app-shell/account';
import type { RailPreference } from '../ui/layout/app-shell/rail-preference';
import { createInitialState } from '../ui/store/state';
import { UiStoreProvider } from '../ui/store/store';

setupRitewayBun();

const member: ShellAccount = {
  state: 'member',
  username: 'ada-byron',
  displayName: null,
  photoId: null,
};

const render = (
  account: ShellAccount = { state: 'anonymous' },
  rail: RailPreference = 'extended',
): string =>
  renderMarkup(
    h(UiStoreProvider, {
      initialState: createInitialState(),
      children: h(AppShell, {
        account,
        activeRoom: null,
        rail,
        ratings: null,
        toggleRail: async () => {},
        children: h('p', null, 'page'),
      }),
    }),
  );

/** The markup of the rail (the first nav). */
const railOf = (html: string): string => html.split('<nav')[1] ?? '';

/**
 * Two kinds of rail markup have no role, name or state to assert instead,
 * so the shell's role-and-name test (ui/layout/app-shell/app-shell.test.tsx)
 * leaves them here:
 *
 * - Responsive visibility and placement, carried by design-system classes
 *   alone: which words show at rail widths (`icon-rail:sr-only`) or only to
 *   screen readers (`sr-only`), the wordmark that hides below the rail
 *   breakpoint (`icon-rail:hidden`), the rail pinned to the viewport
 *   (`sticky top-0 h-dvh`) and the account menu opening beside it
 *   (`absolute left-full`). Every one is in the accessibility tree at every
 *   width.
 * - The account disclosure's `<summary>`: the role mapping the role helper
 *   uses gives `<summary>` no role, so its accessible name (the aria-label
 *   naming the account) and its decorative visible username can only be
 *   read from the markup.
 */
describe('AppShell rail markup', () => {
  test('the rail shows words at rail widths in extended and as screen-reader text in mini (ADR 0091)', () => {
    const extended = railOf(render(member));
    const mini = railOf(render(member, 'mini'));
    assert({
      given: "a member's rail served extended and served mini",
      should:
        'carry every destination name as text at rail widths in extended and as screen-reader text in mini, Minimize included, Expand as screen-reader text',
      actual: [
        extended.includes('<span class="icon-rail:sr-only">Home</span>'),
        extended.includes('<span class="icon-rail:sr-only">Minimize</span>'),
        extended.includes('<span class="icon-rail:sr-only">Messages</span>'),
        mini.includes('<span class="sr-only">Messages</span>'),
        mini.includes('<span class="sr-only">Expand</span>'),
        mini.includes('icon-rail:sr-only'),
      ],
      expected: [true, true, true, true, true, false],
    });
  });

  test('the logo carries the Daisy Debate wordmark beside it in extended, and only the mark in mini', () => {
    const extended = railOf(render(member));
    const mini = railOf(render(member, 'mini'));
    assert({
      given: "a member's rail served extended and served mini",
      should:
        'show the wordmark next to the logo in extended and hide it below the rail breakpoint, and show only the mark in mini',
      actual: [
        extended.includes('<span class="icon-rail:hidden">Daisy Debate</span>'),
        mini.includes('<span class="hidden">Daisy Debate</span>'),
      ],
      expected: [true, true],
    });
  });

  test('the rail is pinned to the viewport at every height, so its foot stays at the bottom', () => {
    const classes =
      railOf(render(member))
        .match(/class="([^"]*)"/)?.[1]
        ?.split(' ') ?? [];
    assert({
      given: "a member's rail on any window height",
      should:
        'stick to the top and fill the viewport, never scroll with the page',
      actual: ['sticky', 'top-0', 'h-dvh'].map((name) =>
        classes.includes(name),
      ),
      expected: [true, true, true],
    });
  });

  test('every rail link has a name, the shortened word decorative', () => {
    const rail = railOf(render(member));
    assert({
      given: "a member's extended rail",
      should:
        'carry the full Friends name as screen-reader text and the shorter word as decoration at rail widths',
      actual: [
        /<span class="sr-only">Friends, \d+ online<\/span>/.test(rail),
        rail.includes(
          '<span aria-hidden="true" class="icon-rail:sr-only">Friends</span>',
        ),
      ],
      expected: [true, true],
    });
  });

  test('a visitor’s Sign in shows as words at rail widths', () => {
    assert({
      given: 'an anonymous visitor on the extended rail',
      should: 'carry Sign in as text at rail widths',
      actual: railOf(render()).includes(
        '<span class="icon-rail:sr-only">Sign in</span>',
      ),
      expected: true,
    });
  });
});

describe('AppShell account menu markup', () => {
  test('the foot is the account menu: the avatar and username open a menu beside the rail', () => {
    const rail = railOf(render(member));
    const foot = rail.slice(rail.indexOf('<details'));
    assert({
      given: "a member's extended rail",
      should:
        'put the avatar and username in a summary named for the account, the visible username decorative, with the menu opening beside the rail',
      actual: [
        foot.includes('<summary'),
        foot.includes('aria-label="Your account, ada-byron"'),
        /<span aria-hidden="true" class="[^"]*">ada-byron<\/span>/.test(foot),
        /class="[^"]*\babsolute\b[^"]*\bleft-full\b/.test(foot),
      ],
      expected: [true, true, true, true],
    });
  });

  test('a member who chose a display name names the account menu by it', () => {
    const rail = railOf(
      render({ ...member, displayName: 'Ada Byron', photoId: 'f'.repeat(24) }),
    );
    const foot = rail.slice(rail.indexOf('<details'));
    assert({
      given: 'a member with a display name and published photo',
      should:
        'name the account summary by the display name and @username, the visible display name decorative',
      actual: [
        foot.includes('aria-label="Your account, Ada Byron (@ada-byron)"'),
        /<span aria-hidden="true" class="[^"]*">Ada Byron<\/span>/.test(foot),
      ],
      expected: [true, true],
    });
  });
});
