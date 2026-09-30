import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sampleResults } from '../../ui/mock/tournament-results';
import {
  certificateText,
  defaultResultsQuery,
  parseResultsQuery,
  resultsHref,
} from './results';

setupRitewayBun();

describe('parseResultsQuery', () => {
  test('defaults, tabs, and mine without a result', () => {
    assert({
      given: 'nothing, a tab, junk, and mine with and without a result',
      should: 'parse, default, and fall back from mine',
      actual: [
        parseResultsQuery({}, true),
        parseResultsQuery({ tab: 'honours', all: '1' }, true),
        parseResultsQuery({ tab: 'x', all: ['1'] }, true),
        parseResultsQuery({ tab: 'mine' }, true).tab,
        parseResultsQuery({ tab: 'mine' }, false).tab,
      ],
      expected: [
        defaultResultsQuery,
        { tab: 'honours', all: true },
        { tab: 'standings', all: true },
        'mine',
        'standings',
      ],
    });
  });

  test('the default tab stays off the URL', () => {
    assert({
      given: 'the default, a tab and standings with all',
      should: 'build short URLs',
      actual: [
        resultsHref('x', defaultResultsQuery),
        resultsHref('x', { tab: 'mine', all: false }),
        resultsHref('x', { tab: 'standings', all: true }),
      ],
      expected: [
        '/tournaments/x/results',
        '/tournaments/x/results?tab=mine',
        '/tournaments/x/results?all=1',
      ],
    });
  });
});

describe('certificateText', () => {
  test('reads as a sentence with the tournament facts', () => {
    const data = sampleResults('summer-invitational', true);
    const mine = data?.mine;
    if (!data || !mine) throw new Error('no sample result');
    assert({
      given: 'the runner-up certificate for Summer Invitational',
      should:
        'name the placing, tournament, size, date and that it was unrated',
      actual: certificateText(data.tournament, mine.certificate),
      expected:
        'placed second as runner-up in the Summer Invitational, a single-elimination tournament of 16 entrants held on Saturday 29 August 2026. This tournament was unrated.',
    });
  });
});
