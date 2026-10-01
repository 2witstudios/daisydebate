import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { listTournaments } from '../../../features/tournaments/list-tournaments';
import {
  defaultQuery,
  type TournamentsQuery,
} from '../../../features/tournaments/query';
import { TournamentsIndex } from './tournaments-index';

setupRitewayBun();

const render = (query: TournamentsQuery, signedIn = true) =>
  renderToString(
    h(TournamentsIndex, { listing: listTournaments(query, signedIn), query }),
  );

describe('TournamentsIndex', () => {
  test('the default page', () => {
    const html = render(defaultQuery);
    assert({
      given: 'the default index',
      should:
        'have one h1, the featured card, four rows, the filter form and the aside',
      actual: [
        html.match(/<h1 /g)?.length,
        html.includes('aria-label="Featured tournament"'),
        html.match(/<li class="[^"]*min-h-16/g)?.length,
        html.includes('aria-label="Filter tournaments"'),
        html.includes('aria-label="Your tournaments"'),
        html.includes('Weeknight Sprint'),
        html.includes('a tournament never changes your rating'),
      ],
      expected: [1, true, 4, true, true, true, true],
    });
  });

  test('each row offers its one action', () => {
    const html = render(defaultQuery);
    assert({
      given: 'the open tab',
      should: 'View the registered one, Register the others',
      actual: [
        html.match(/>Register</g)?.length,
        /href="\/tournaments\/autumn-open"[^>]*>View</.test(html),
        /href="\/tournaments\/enter\/weeknight-sprint"[^>]*>Register</.test(
          html,
        ),
      ],
      expected: [3, true, true],
    });
  });

  test('upcoming shows an inert reminder, not a fake link', () => {
    const html = render({ ...defaultQuery, tab: 'upcoming' });
    assert({
      given: 'the upcoming tab',
      should: 'show a disabled Remind me and a Join waitlist link',
      actual: [
        html.includes('Remind me (Reminders arrive with notifications.)'),
        /href="\/tournaments\/enter\/night-owl-open"[^>]*>Join waitlist</.test(
          html,
        ),
      ],
      expected: [true, true],
    });
  });

  test('filters that match nothing', () => {
    const html = render({ ...defaultQuery, q: 'zzz' });
    assert({
      given: 'a search with no match',
      should: 'show the no-match state with its clear link and 0 tournaments',
      actual: [
        html.includes('No tournaments match these filters'),
        html.includes('0 tournaments'),
        html.includes('href="/tournaments"'),
      ],
      expected: [true, true, true],
    });
  });

  test('signed out', () => {
    const html = render(defaultQuery, false);
    assert({
      given: 'an anonymous visitor',
      should: 'still list tournaments and offer sign-in',
      actual: [
        html.includes('Autumn Open'),
        html.includes('Sign in to register'),
        html.includes('You are registered'),
      ],
      expected: [true, true, false],
    });
  });
});
