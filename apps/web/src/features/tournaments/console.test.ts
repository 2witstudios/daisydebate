import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sampleConsole } from '../../ui/mock/tournament-console';
import {
  assignJudges,
  consoleHref,
  pairRound,
  parseConsoleQuery,
  publishChecklist,
  roundStateOf,
} from './console';
import { getConsole } from './get-console';

setupRitewayBun();

const autumn = sampleConsole('autumn-open');
const harvest = sampleConsole('harvest-cup');
if (!autumn || !harvest) throw new Error('no sample console');

describe('parseConsoleQuery and consoleHref', () => {
  test('defaults, valid and hostile values', () => {
    assert({
      given: 'nothing, valid values and junk',
      should: 'default to rounds with the tournament deciding the round',
      actual: [
        parseConsoleQuery({}),
        parseConsoleQuery({ tab: 'results', round: 'running' }),
        parseConsoleQuery({ tab: ['publish'], round: ['nope'] }),
        parseConsoleQuery({ tab: 'admin' }),
      ],
      expected: [
        { tab: 'rounds', round: null },
        { tab: 'results', round: 'running' },
        { tab: 'publish', round: null },
        { tab: 'rounds', round: null },
      ],
    });
  });

  test('the default tab and an unset round stay off the URL', () => {
    assert({
      given: 'the default, a tab and a round',
      should: 'build short URLs',
      actual: [
        consoleHref('x', { tab: 'rounds', round: null }),
        consoleHref('x', { tab: 'entrants', round: null }),
        consoleHref('x', { tab: 'rounds', round: 'generated' }),
      ],
      expected: [
        '/tournaments/organize/x',
        '/tournaments/organize/x?tab=entrants',
        '/tournaments/organize/x?round=generated',
      ],
    });
  });
});

describe('pairRound', () => {
  test('byes for the top seeds, then highest against lowest', () => {
    const { debates, byes } = pairRound(autumn.entrants, 32);
    assert({
      given: '24 entrants in a 32-place bracket',
      should: 'give seeds 1 to 8 byes and pair 9v24 through 16v17',
      actual: [
        byes.map((entrant) => entrant.seed),
        debates.length,
        debates[0] && [
          debates[0].id,
          debates[0].a.seed,
          debates[0].b.seed,
          debates[0].room,
        ],
        debates.at(-1) && [debates.at(-1)?.a.seed, debates.at(-1)?.b.seed],
      ],
      expected: [
        [1, 2, 3, 4, 5, 6, 7, 8],
        8,
        ['D1', 9, 24, 'Room 1'],
        [16, 17],
      ],
    });
  });

  test('a full bracket has no byes', () => {
    const { debates, byes } = pairRound(harvest.entrants, 8);
    assert({
      given: '8 entrants in 8 places',
      should: 'pair 1v8, 2v7, 3v6, 4v5 and give no byes',
      actual: [byes.length, debates.map((d) => `${d.a.seed}v${d.b.seed}`)],
      expected: [0, ['1v8', '2v7', '3v6', '4v5']],
    });
  });
});

describe('assignJudges', () => {
  test('one judge per debate, in order, with a sample reassignment', () => {
    const { debates } = pairRound(autumn.entrants, 32);
    const assigned = assignJudges(debates);
    assert({
      given: 'eight debates',
      should: 'name judge-01 to judge-08 and mark the sixth reassigned',
      actual: [
        assigned.map((item) => item.judge).join(' '),
        assigned.map((item) => item.conflict).filter((c) => c === 'Reassigned')
          .length,
        assigned[5]?.conflict,
      ],
      expected: [
        'judge-01 judge-02 judge-03 judge-04 judge-05 judge-06 judge-07 judge-08',
        1,
        'Reassigned',
      ],
    });
  });
});

describe('publishChecklist', () => {
  test('never ready in the samples while a result is missing or a report open', () => {
    const running = publishChecklist(autumn, 'running');
    const setup = publishChecklist(autumn, 'setup');
    assert({
      given: 'the running and the not-started console',
      should: 'list four items, counting missing results and open reports',
      actual: [
        running.items.map((item) => item.text),
        running.ready,
        setup.items.map((item) => item.ok),
        setup.ready,
      ],
      expected: [
        [
          'All 5 rounds complete (0 of 5 done, round 1 in progress)',
          'No open conduct reports (1 open)',
          'No debate is missing a result (1 missing)',
          'Final standings can be computed from ballots',
        ],
        false,
        [false, true, true, false],
        false,
      ],
    });
  });
});

describe('roundStateOf and getConsole', () => {
  test('the URL wins, else the tournament’s own state; unknown is null', () => {
    assert({
      given: 'registration and in-progress tournaments',
      should: 'default to setup and running unless the URL names a round',
      actual: [
        roundStateOf(autumn, { tab: 'rounds', round: null }),
        roundStateOf(harvest, { tab: 'rounds', round: null }),
        roundStateOf(harvest, { tab: 'rounds', round: 'released' }),
        getConsole('nope'),
        getConsole('summer-invitational'),
      ],
      expected: ['setup', 'running', 'released', null, null],
    });
  });
});
