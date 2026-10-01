import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { listTournaments } from '../../../../features/tournaments/list-tournaments';
import { defaultQuery } from '../../../../features/tournaments/query';
import { YourTournaments } from './your-tournaments';

setupRitewayBun();

const render = (signedIn: boolean) =>
  renderToString(
    h(YourTournaments, {
      yours: listTournaments(defaultQuery, signedIn).yours,
      signedIn,
    }),
  );

describe('YourTournaments', () => {
  test('signed in: the three entries with their standing', () => {
    const html = render(true);
    assert({
      given: 'the sample viewer',
      should:
        'list Harvest Cup with its event link, registered and waitlist entries',
      actual: [
        html.includes('aria-label="Your tournaments"'),
        html.includes('href="/tournaments/mine/harvest-cup"'),
        html.includes('Registered'),
        html.includes('Waitlist 2 of 3'),
        html.includes('href="/tournaments/organize/new"'),
      ],
      expected: [true, true, true, true, true],
    });
  });

  test('signed out: a sign-in prompt instead of entries', () => {
    const html = render(false);
    assert({
      given: 'an anonymous visitor',
      should: 'explain the public rules and offer Sign in',
      actual: [
        html.includes('Signed out: anyone can browse'),
        html.includes('href="/sign-in?next=%2Ftournaments"'),
        html.includes('Harvest Cup'),
      ],
      expected: [true, true, false],
    });
  });

  test('signed in with nothing entered', () => {
    const html = renderToString(
      h(YourTournaments, { yours: [], signedIn: true }),
    );
    assert({
      given: 'no entries',
      should: 'say entries appear here',
      actual: html.includes('Tournaments you enter appear here.'),
      expected: true,
    });
  });
});
