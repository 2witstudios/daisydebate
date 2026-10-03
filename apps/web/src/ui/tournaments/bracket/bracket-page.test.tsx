import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  parseBracketView,
  type BracketView,
} from '../../../features/tournaments/bracket';
import { getBracket } from '../../../features/tournaments/get-bracket';
import { NOW } from '../../../features/tournaments/tournament.test-support';
import { sampleTournaments } from '../../mock/tournaments';
import { BracketPage, NotPosted } from './bracket-page';

setupRitewayBun();

const render = (id: string, view?: BracketView, signedIn = true) => {
  const read = getBracket(id, signedIn, NOW);
  if (read.kind !== 'bracket') throw new Error('no bracket');
  return renderToString(
    h(BracketPage, {
      data: read.data,
      view: view ?? parseBracketView({}, read.data.tournament.structure),
      viewerHandle: read.viewerHandle,
      myEvent: signedIn && id === 'harvest-cup',
    }),
  );
};

describe('BracketPage, single elimination', () => {
  test('the bracket: live strip, view links, one tree ending at the champion and your path', () => {
    const html = render('harvest-cup');
    assert({
      given: 'Harvest Cup on the bracket view',
      should:
        'show one h1, the live line, both views, the champion at the end of the tree and mark the viewer',
      actual: [
        html.match(/<h1 /g)?.length,
        /role="status"[^>]*>.*Live\./.test(html),
        html.includes('Semifinals in progress. Next: Final today'),
        html.includes('aria-label="View"'),
        html.includes('href="/tournaments/harvest-cup/bracket?view=rounds"'),
        html.includes('Decided after the final'),
        html.includes('Live, 31 watching'),
        html.includes('border-accent'),
        html.includes('Open my event'),
      ],
      expected: [1, true, true, true, true, true, true, true, true],
    });
  });

  test('the tree has every match, joined by branches, and no dangling line', () => {
    const html = render('harvest-cup');
    assert({
      given: 'Harvest Cup, eight entrants',
      should:
        'draw seven matches and the champion, one feeder branch per match but the champion, and the quarterfinals as leaves',
      actual: [
        (html.match(/Quarterfinal \d, done/g) ?? []).length,
        html.match(/class="bracket-card"/g)?.length,
        html.match(/class="bracket-end"/g)?.length,
        html.match(/class="bracket-feeder"/g)?.length,
        html.includes('class="bracket-stub"'),
      ],
      expected: [4, 7, 1, 7, true],
    });
  });

  test('by round lists every match with watch and recording links', () => {
    const html = render('harvest-cup', 'rounds');
    assert({
      given: 'the by-round view',
      should:
        'list eight matches, watch live ones and link recordings for done ones',
      actual: [
        html.match(/<li class="[^"]*border-t/g)?.length,
        html.includes('@debater-c won'),
        /href="\/watch"[^>]*>Watch</.test(html),
        /href="\/recordings"[^>]*>Recording</.test(html),
        html.includes('Not started'),
      ],
      expected: [7, true, true, true, true],
    });
  });

  test('signed out: no path marking and no event link', () => {
    const html = render('harvest-cup', undefined, false);
    assert({
      given: 'an anonymous visitor',
      should: 'show the bracket without You or Open my event',
      actual: [
        html.includes('>You<'),
        html.includes('Open my event'),
        html.includes('Quarterfinal 1'),
      ],
      expected: [false, false, true],
    });
  });
});

describe('BracketPage, round robin', () => {
  test('standings is the default with the sample tiebreak note', () => {
    const html = render('club-championship');
    assert({
      given: 'Club Championship',
      should: 'show the table with eight rows, the next round and the note',
      actual: [
        html.includes('<caption class="sr-only">Standings</caption>'),
        html.match(/<tr class="border-t/g)?.length,
        html.includes('R3 vs @debater-j'),
        html.includes('the organizer sets the real'),
        html.includes('Round 3 of 7 begins at'),
        html.includes(
          'href="/tournaments/club-championship/bracket?view=grid"',
        ),
      ],
      expected: [true, 8, true, true, true, true],
    });
  });

  test('results grid and rounds', () => {
    const grid = render('club-championship', 'grid');
    const rounds = render('club-championship', 'rounds');
    assert({
      given: 'the grid and the rounds views',
      should: 'show W, L and round cells, then rounds 3, 2 and 1',
      actual: [
        grid.includes('Results grid'),
        grid.includes('>R7<'),
        grid.includes('>W<'),
        rounds.indexOf('Round 3') < rounds.indexOf('Round 2'),
        rounds.includes('beat @debater-j'),
        rounds.includes('Rounds 4 to 7 are scheduled'),
      ],
      expected: [true, true, true, true, true, true],
    });
  });
});

describe('NotPosted', () => {
  test('before the bracket and after the tournament', () => {
    const find = (id: string) =>
      sampleTournaments.find((item) => item.id === id);
    const before = find('autumn-open');
    const after = find('summer-invitational');
    if (!before || !after) throw new Error('no sample');
    const a = renderToString(h(NotPosted, { tournament: before }));
    const b = renderToString(h(NotPosted, { tournament: after }));
    assert({
      given: 'an open tournament and a finished one',
      should: 'say not out yet with a way back, or over with the results',
      actual: [
        a.includes('The Autumn Open bracket is not out yet'),
        a.includes('href="/tournaments/autumn-open"'),
        b.includes('Summer Invitational is over'),
        b.includes('href="/tournaments/summer-invitational/results"'),
      ],
      expected: [true, true, true, true],
    });
  });
});
