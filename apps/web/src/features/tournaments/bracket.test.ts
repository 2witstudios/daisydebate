import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sampleBracket } from '../../ui/mock/tournament-brackets';
import {
  bracketHref,
  parseBracketView,
  resultsGrid,
  standings,
  viewsFor,
  type RobinData,
} from './bracket';
import { NOW } from './tournament.test-support';

setupRitewayBun();

const club = sampleBracket('club-championship', NOW) as RobinData;

describe('views', () => {
  test('each structure offers its views and defaults to the first', () => {
    assert({
      given: 'both structures, valid, foreign and hostile views',
      should: 'keep valid views and fall back to the first otherwise',
      actual: [
        viewsFor('single-elimination'),
        viewsFor('round-robin'),
        parseBracketView({ view: 'rounds' }, 'single-elimination'),
        parseBracketView({ view: 'grid' }, 'single-elimination'),
        parseBracketView({ view: ['grid'] }, 'round-robin'),
        parseBracketView({}, 'round-robin'),
        parseBracketView({ view: '../x' }, 'round-robin'),
      ],
      expected: [
        ['bracket', 'rounds'],
        ['standings', 'grid', 'rounds'],
        'rounds',
        'bracket',
        'grid',
        'standings',
        'standings',
      ],
    });
  });

  test('the default view stays off the URL', () => {
    assert({
      given: 'the default and another view',
      should: 'build short URLs',
      actual: [
        bracketHref('x', 'bracket', 'single-elimination'),
        bracketHref('x', 'rounds', 'single-elimination'),
        bracketHref('y', 'standings', 'round-robin'),
        bracketHref('y', 'grid', 'round-robin'),
      ],
      expected: [
        '/tournaments/x/bracket',
        '/tournaments/x/bracket?view=rounds',
        '/tournaments/y/bracket',
        '/tournaments/y/bracket?view=grid',
      ],
    });
  });
});

describe('standings', () => {
  test('ranked by wins, then wins of the opponents met, then handle', () => {
    assert({
      given: 'round robin rounds 1 and 2 played',
      should: 'order d, a, g, c, j, b, i, h with their records',
      actual: standings(club).map(
        (row) =>
          `${row.rank} ${row.handle.slice(-1)} ${row.won}-${row.lost} opp ${row.opponentWins}`,
      ),
      expected: [
        '1 d 2-0 opp 2',
        '2 a 2-0 opp 1',
        '3 g 1-1 opp 3',
        '4 c 1-1 opp 2',
        '5 j 1-1 opp 2',
        '6 b 1-1 opp 1',
        '7 i 0-2 opp 3',
        '8 h 0-2 opp 2',
      ],
    });
  });

  test('the next round pairs each debater', () => {
    const next = standings(club).map(
      (row) =>
        `${row.handle.slice(-1)}:${row.next?.round}:${row.next?.opponent.slice(-1)}`,
    );
    assert({
      given: 'round 3 out',
      should: 'name each debater’s round 3 opponent',
      actual: next,
      expected: [
        'd:3:j',
        'a:3:h',
        'g:3:i',
        'c:3:b',
        'j:3:d',
        'b:3:c',
        'i:3:g',
        'h:3:a',
      ],
    });
  });
});

describe('resultsGrid', () => {
  test('won, lost, upcoming round and self', () => {
    const grid = resultsGrid(club);
    const row = (letter: string) =>
      grid
        .find((r) => r.handle === `debater-${letter}`)
        ?.cells.map((cell) =>
          cell.kind === 'round'
            ? `R${cell.number}`
            : cell.kind === 'self'
              ? '-'
              : cell.kind === 'won'
                ? 'W'
                : 'L',
        )
        .join(' ');
    assert({
      given: 'the sample round robin',
      should: 'match the published grid for a and j',
      actual: [row('a'), row('j')],
      expected: ['- R7 R6 R5 R4 R3 W W', 'L R4 R7 R3 R6 W R5 -'],
    });
  });

  test('every pair meets exactly once', () => {
    const pairs = club.rounds.flatMap((round) =>
      round.tables.map((t) => [t.a, t.b].sort().join('|')),
    );
    assert({
      given: 'seven rounds of four tables',
      should: 'have 28 distinct pairs',
      actual: [pairs.length, new Set(pairs).size],
      expected: [28, 28],
    });
  });
});

describe('sampleBracket', () => {
  test('only the two in-progress tournaments have one', () => {
    assert({
      given: 'harvest cup, club championship and autumn open',
      should: 'return elimination, round robin and null',
      actual: ['harvest-cup', 'club-championship', 'autumn-open'].map(
        (id) => sampleBracket(id, NOW)?.kind ?? null,
      ),
      expected: ['elimination', 'round-robin', null],
    });
  });
});
