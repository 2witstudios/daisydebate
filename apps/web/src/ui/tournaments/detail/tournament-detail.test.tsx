import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  defaultDetailQuery,
  type DetailQuery,
} from '../../../features/tournaments/detail-query';
import { getTournament } from '../../../features/tournaments/get-tournament';
import { TournamentDetail } from './tournament-detail';

setupRitewayBun();

const render = (
  id: string,
  query: Partial<DetailQuery> = {},
  signedIn = true,
) => {
  const view = getTournament(id, signedIn);
  if (!view) throw new Error(`no sample ${id}`);
  return renderToString(
    h(TournamentDetail, { view, query: { ...defaultDetailQuery, ...query } }),
  );
};

describe('TournamentDetail', () => {
  test('overview with the registration panel', () => {
    const html = render('autumn-open');
    assert({
      given: 'Autumn Open overview, viewer registered',
      should: 'have one h1, breadcrumb, four tab links, sections and the panel',
      actual: [
        html.match(/<h1 /g)?.length,
        html.includes('aria-label="Breadcrumb"'),
        html.includes('aria-label="Tournament sections"'),
        html.includes('About this tournament'),
        html.includes('Structure and rules'),
        html.includes('Recognition'),
        html.includes('You are registered'),
        html.includes('Times are UTC.'),
        html.includes('>Unrated<'),
      ],
      expected: [1, true, true, true, true, true, true, true, true],
    });
  });

  test('entrants page one, then all', () => {
    const first = render('autumn-open', { tab: 'entrants' });
    const all = render('autumn-open', { tab: 'entrants', all: true });
    assert({
      given: 'the entrants tab with 24 entered',
      should: 'show 10 with a Show all link, then 24 with none; mark You',
      actual: [
        first.match(/<li class="[^"]*border-t border-border px-5/g)?.length,
        first.includes(
          'href="/tournaments/autumn-open?tab=entrants&amp;all=1"',
        ),
        all.match(/<li class="[^"]*border-t border-border px-5/g)?.length,
        all.includes('Show all'),
        first.includes('>You<'),
        first.includes('Provisional'),
        first.includes('24 entered, 8 places left'),
      ],
      expected: [10, true, 24, false, true, true, true],
    });
  });

  test('no entrants yet', () => {
    assert({
      given: 'an announced tournament with nobody in',
      should: 'say no one has entered',
      actual: render('winter-open', { tab: 'entrants' }).includes(
        'No one has entered yet.',
      ),
      expected: true,
    });
  });

  test('bracket tab: placeholder before, link after', () => {
    const before = render('autumn-open', { tab: 'bracket' });
    const after = render('harvest-cup', { tab: 'bracket' });
    assert({
      given: 'an open tournament and a live one',
      should: 'explain the post time, then link to the bracket',
      actual: [
        before.includes('Bracket not posted yet'),
        before.includes('Get a message when it posts'),
        after.includes('href="/tournaments/harvest-cup/bracket"'),
      ],
      expected: [true, true, true],
    });
  });

  test('rules tab lists the five cards', () => {
    const html = render('novice-cup', { tab: 'rules' });
    assert({
      given: 'a custom-rules tournament',
      should: 'show the custom rules card, the judging card and six headings',
      actual: [
        html.includes('Custom rules'),
        html.includes('Judges are assigned'),
        html.match(/<h2 /g)?.length,
      ],
      expected: [true, true, 6], // five rule cards and the registration panel
    });
  });

  test('every registration state renders its panel', () => {
    const headline = (id: string, signedIn = true) =>
      /aria-label="Registration"[^>]*><h2[^>]*>([^<]*)</.exec(
        render(id, {}, signedIn),
      )?.[1];
    assert({
      given: 'each sample tournament kind',
      should: 'show the headline for its state',
      actual: [
        headline('weeknight-sprint'),
        headline('night-owl-open'),
        headline('novice-cup'),
        headline('hollow-cup'),
        headline('winter-open'),
        headline('harvest-cup'),
        headline('club-championship'),
        headline('summer-invitational'),
        headline('autumn-open', false),
      ],
      expected: [
        'Registration open',
        'Full, waitlist open',
        'Waitlisted, position 2',
        'Registration closed',
        'Not open yet',
        'You are competing',
        'In progress',
        'Completed',
        'Registration open',
      ],
    });
  });
});
