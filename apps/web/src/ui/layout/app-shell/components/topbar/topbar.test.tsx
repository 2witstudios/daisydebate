import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { Topbar, type ShellAccount } from './topbar';
import { createInitialState } from '../../../../store/state';
import { setUiState } from '../../../../store/store';

setupRitewayBun();

const seed = createInitialState();

const renderWith = (
  notificationsCount: number,
  account: ShellAccount = { state: 'anonymous' },
): string => {
  setUiState({
    ...seed,
    resources: {
      ...seed.resources,
      notificationsCount,
    },
  });
  return renderToString(h(Topbar, { account }));
};

describe('Topbar', () => {
  test('is the banner with a home brand link and labelled controls', () => {
    const html = renderWith(3);
    assert({
      given: 'the topbar',
      should: 'render a header, link the brand home, and name its controls',
      actual: [
        html.includes('<header'),
        /<a [^>]*href="\/"/.test(html),
        html.includes('aria-label="Notifications"'),
        html.includes('type="search"'),
        html.includes('aria-label="Search"'),
      ],
      expected: [true, true, true, true, true],
    });
  });

  test('offers sign-in to an anonymous visitor', () => {
    const html = renderWith(0);
    assert({
      given: 'an anonymous visitor',
      should: 'show a Sign in link to /sign-in and no username',
      actual: [/<a [^>]*href="\/sign-in"[^>]*>Sign in</.test(html)],
      expected: [true],
    });
  });

  test('sends a provisional account back to finish sign-up', () => {
    const html = renderWith(0, { state: 'provisional' });
    assert({
      given: 'an account that has not chosen a username',
      should: 'show a Finish sign-up link to onboarding',
      actual: /<a [^>]*href="\/onboarding\/username"[^>]*>Finish sign-up</.test(
        html,
      ),
      expected: true,
    });
  });

  test('shows the chosen username as the display identity', () => {
    const html = renderWith(0, { state: 'member', username: 'ada_byron' });
    assert({
      given: 'a member',
      should: 'link their username to settings with an accessible name',
      actual: [
        html.includes('ada_byron'),
        html.includes('aria-label="Account settings for ada_byron"'),
        /href="\/settings"/.test(html),
        html.includes('Sign in<'),
      ],
      expected: [true, true, true, false],
    });
  });

  test('shows the notification badge only when something is unread', () => {
    const badge = (html: string): string | undefined =>
      /<span[^>]* aria-hidden="true">(\d+)<\/span>/.exec(html)?.[1];
    assert({
      given: 'three and then zero unread notifications',
      should: 'render the count badge only for the unread case',
      actual: [badge(renderWith(3)), badge(renderWith(0))],
      expected: ['3', undefined],
    });
  });
});
