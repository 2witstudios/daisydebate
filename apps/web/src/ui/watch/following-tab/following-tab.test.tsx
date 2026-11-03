import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { FollowingTab } from './following-tab';

setupRitewayBun();

describe('FollowingTab', () => {
  test('a signed-in viewer', () => {
    const html = renderToString(
      h(FollowingTab, {
        following: {
          people: [
            {
              handle: 'ana',
              live: {
                id: 'quarterfinal-practice',
                title: 'Quarterfinal practice',
              },
              lastRound: null,
            },
          ],
          history: [
            {
              id: 'semifinal-rehearsal',
              title: 'Semifinal rehearsal',
              note: 'Replay',
            },
          ],
        },
        signInHref: '/sign-in',
      }),
    );
    assert({
      given: 'a member with follows and history',
      should: 'link a live follow to its Round and history to replays',
      actual: [
        html.includes('Live now in Quarterfinal practice'),
        html.includes('href="/watch/quarterfinal-practice"'),
        html.includes('href="/recordings/semifinal-rehearsal"'),
        html.includes('Clear history'),
      ],
      expected: [true, true, true, false],
    });
  });

  test('nothing followed or watched', () => {
    const html = renderToString(
      h(FollowingTab, {
        following: { people: [], history: [] },
        signInHref: '/sign-in',
      }),
    );
    assert({
      given: 'a member with no follows or history',
      should: 'say so in each section',
      actual: [html.includes('Nobody yet.'), html.includes('Nothing yet.')],
      expected: [true, true],
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
