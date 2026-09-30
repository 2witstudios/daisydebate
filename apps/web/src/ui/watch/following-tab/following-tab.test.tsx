import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  followingOf,
  watchViewer,
} from '../../../features/watch/debate-source';
import { FollowingTab } from './following-tab';

setupRitewayBun();

describe('FollowingTab', () => {
  test('a signed-in viewer', () => {
    const html = renderToString(
      h(FollowingTab, {
        following: followingOf(watchViewer(true)),
        signInHref: '/sign-in',
      }),
    );
    assert({
      given: 'a member with follows and history',
      should:
        'link a live follow to its debate, history to replays, and say it is private',
      actual: [
        html.includes('Live now in Quarterfinal practice'),
        html.includes('href="/watch/quarterfinal-practice"'),
        html.includes('href="/recordings/semifinal-rehearsal"'),
        /<button [^>]*disabled=""/.test(html),
        html.includes('private to you'),
      ],
      expected: [true, true, true, true, true],
    });
  });

  test('a signed-out visitor', () => {
    const html = renderToString(
      h(FollowingTab, {
        following: null,
        signInHref: '/sign-in?next=%2Fwatch',
      }),
    );
    assert({
      given: 'no account',
      should: 'ask them to sign in, and show nothing private',
      actual: [
        html.includes('Sign in to follow debaters'),
        html.includes('href="/sign-in?next=%2Fwatch"'),
        html.includes('People you follow'),
      ],
      expected: [true, true, false],
    });
  });
});
