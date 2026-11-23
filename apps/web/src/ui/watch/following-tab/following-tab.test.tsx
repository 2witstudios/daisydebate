import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { FollowingTab } from './following-tab';

setupRitewayBun();

describe('FollowingTab', () => {
  test('a signed-in viewer', () => {
    const view = renderAccessible(
      h(FollowingTab, {
        following: {
          people: [
            {
              handle: 'ana',
              live: {
                id: 'quarterfinal-practice',
                title: 'Quarterfinal practice',
              },
            },
            { handle: 'lin', live: null },
          ],
          history: [
            {
              id: 'semifinal-rehearsal',
              title: 'Semifinal rehearsal',
              watchedOn: '2026-11-02',
            },
          ],
        },
        signInHref: '/sign-in',
      }),
    );
    const people = view.within('region', 'People you follow');
    const history = view.within('region', 'Recently watched');
    assert({
      given: 'a member with follows and history',
      should:
        'link a live follow to its Round, say who is not live, and open what was watched on the page that serves it in any state',
      actual: [
        people.textContent().includes('Live now in Quarterfinal practice'),
        people.attribute('link', 'Watch', 'href'),
        people.textContent().includes('Not live now'),
        history.attribute('link', 'Open', 'href'),
        history.textContent().includes('Watched 2026-11-02'),
        view.textContent().includes('Clear history'),
      ],
      expected: [
        true,
        '/watch/quarterfinal-practice',
        true,
        '/watch/semifinal-rehearsal',
        true,
        false,
      ],
    });
  });

  test('nothing followed or watched', () => {
    const view = renderAccessible(
      h(FollowingTab, {
        following: { people: [], history: [] },
        signInHref: '/sign-in',
      }),
    );
    assert({
      given: 'a member with no follows or history',
      should: 'say so in each section',
      actual: [
        view
          .within('region', 'People you follow')
          .textContent()
          .includes('Nobody yet.'),
        view
          .within('region', 'Recently watched')
          .textContent()
          .includes('Nothing yet.'),
      ],
      expected: [true, true],
    });
  });

  test('a signed-out visitor', () => {
    const view = renderAccessible(
      h(FollowingTab, {
        following: null,
        signInHref: '/sign-in?next=%2Fwatch',
      }),
    );
    assert({
      given: 'no account',
      should: 'ask them to sign in, and show nothing private',
      actual: [
        view.has('heading', 'Sign in to follow debaters'),
        view.attribute('link', 'Sign in', 'href'),
        view.textContent().includes('People you follow'),
      ],
      expected: [true, '/sign-in?next=%2Fwatch', false],
    });
  });
});
