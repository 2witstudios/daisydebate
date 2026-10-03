import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { getProfile } from '../../../features/profile/get-profile';
import { ProfilePage } from './profile-page';

setupRitewayBun();

const now = '2026-10-03T12:00:00.000Z';
const render = (username: string, viewer: string | null) =>
  renderToString(
    h(ProfilePage, { profile: getProfile(username, viewer, now) }),
  );

describe('ProfilePage', () => {
  test('a debater on the ladder', () => {
    const html = render('debater-a', null);
    assert({
      given: 'a debater with ranked debates, seen by a visitor',
      should:
        'show their name once, rating stats, the chart, honours, achievements and no edit link',
      actual: [
        html.match(/<h1 /g)?.length,
        html.includes('>@debater-a<'),
        html.includes('aria-label="Rating"'),
        html.includes('Rating history') || html.includes('role="img"'),
        html.includes('Tournament honours'),
        html.includes('aria-label="Achievements"'),
        html.includes('Edit profile'),
      ],
      expected: [1, true, true, true, true, true, false],
    });
  });

  test('your own profile', () => {
    const html = render('debater-a', 'debater-a');
    assert({
      given: 'the owner of a profile',
      should: 'mark it as theirs and link to Settings',
      actual: [
        html.includes('>You<'),
        html.includes('href="/settings"'),
        html.includes('Edit profile'),
      ],
      expected: [true, true, true],
    });
  });

  test('a debater with no ranked debates', () => {
    const html = render('somebody-new', null);
    assert({
      given: 'a name with no ranked debates',
      should: 'say so and show no results or seasons',
      actual: [
        html.includes('no ranked debates'),
        html.includes('Recent results'),
        html.includes('Seasons played'),
      ],
      expected: [true, false, false],
    });
  });
});
