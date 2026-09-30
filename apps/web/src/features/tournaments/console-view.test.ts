import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sampleConsole } from '../../ui/mock/tournament-console';
import { parseConsoleQuery, type ConsoleQuery } from './console';
import { consoleView } from './console-view';

setupRitewayBun();

const autumn = sampleConsole('autumn-open');
const harvest = sampleConsole('harvest-cup');
if (!autumn || !harvest) throw new Error('no sample console');

const view = (
  round: ConsoleQuery['round'],
  tab: ConsoleQuery['tab'] = 'rounds',
) => consoleView(autumn, { tab, round });

describe('consoleView: rounds', () => {
  test('each state enables exactly the next step', () => {
    const enabled = (round: ConsoleQuery['round']) =>
      view(round).steps.map((step) => step.enabled);
    assert({
      given: 'each round state',
      should: 'enable generate, then assign, then release, then nothing',
      actual: [
        enabled('setup'),
        enabled('generated'),
        enabled('assigned'),
        enabled('released'),
        enabled('running'),
      ],
      expected: [
        [true, false, false],
        [false, true, false],
        [false, false, true],
        [false, false, false],
        [false, false, false],
      ],
    });
  });

  test('steps go to the next state through the URL', () => {
    assert({
      given: 'the setup state',
      should: 'link the three steps to generated, assigned and released',
      actual: view('setup').steps.map((step) => step.href),
      expected: [
        '/tournaments/organize/autumn-open?round=generated',
        '/tournaments/organize/autumn-open?round=assigned',
        '/tournaments/organize/autumn-open?round=released',
      ],
    });
  });

  test('pairings appear once generated; judges once assigned', () => {
    const at = (round: ConsoleQuery['round']) => {
      const v = view(round);
      return [
        v.pairings?.debates.length ?? null,
        v.pairings?.byes.length ?? null,
        v.judges?.length ?? null,
      ];
    };
    assert({
      given: 'setup, generated and assigned',
      should: 'show none, then 8 debates and 8 byes, then 8 judges too',
      actual: [at('setup'), at('generated'), at('assigned')],
      expected: [
        [null, null, null],
        [8, 8, null],
        [8, 8, 8],
      ],
    });
  });

  test('the phase label tracks the state', () => {
    assert({
      given: 'each round state',
      should: 'describe the round of 32',
      actual: (
        ['setup', 'generated', 'assigned', 'released', 'running'] as const
      ).map((round) => view(round).phaseLabel),
      expected: [
        'Round of 32: pairings not made',
        'Round of 32: pairings made, no judges yet',
        'Round of 32: ready to release',
        'Round of 32: released, check-in opens 13:50',
        'Round of 32: debates in progress',
      ],
    });
  });
});

describe('consoleView: results and publish', () => {
  test('running debates need a result and a forfeit to confirm', () => {
    const v = view('running', 'results');
    assert({
      given: 'eight running debates',
      should: 'list eight rows with D5 needing a result and D8 a forfeit',
      actual: [
        v.results.map((row) => row.status),
        v.enterResult && [
          v.enterResult.debate,
          v.enterResult.a,
          v.enterResult.b,
        ],
        v.forfeit?.id,
        v.results.filter((row) => row.live).length,
      ],
      expected: [
        [
          'Ballot in',
          'Ballot in',
          'In progress',
          'Ballot in',
          'Needs result',
          'In progress',
          'Ballot in',
          'Forfeit to confirm',
        ],
        ['D5', 'entrant-13', 'entrant-20'],
        'D8',
        2,
      ],
    });
  });

  test('before debates run there are no results', () => {
    const v = view('released', 'results');
    assert({
      given: 'a released round',
      should: 'have no rows, no result form and no forfeit',
      actual: [v.results.length, v.enterResult, v.forfeit],
      expected: [0, null, null],
    });
  });

  test('a tournament already running opens on its results state', () => {
    const v = consoleView(harvest, parseConsoleQuery({ tab: 'results' }));
    assert({
      given: 'Harvest Cup with no round in the URL',
      should: 'be running with four debates and D3 needing a result',
      actual: [
        v.state,
        v.results.length,
        v.enterResult?.debate,
        v.publish.ready,
      ],
      expected: ['running', 4, 'D3', false],
    });
  });
});

describe('consoleView: tabs and entrants', () => {
  test('five tabs with counts, keeping the round in the URL', () => {
    const v = view('generated', 'entrants');
    assert({
      given: 'the entrants tab on the generated state',
      should: 'mark entrants selected with counts and keep round=generated',
      actual: [
        v.tabs.map(
          (tab) =>
            `${tab.id}${tab.count === undefined ? '' : `:${tab.count}`}${tab.selected ? '*' : ''}`,
        ),
        v.tabs[2]?.href,
        v.entrantsHeading,
      ],
      expected: [
        ['entrants:24*', 'rounds', 'results', 'moderation:2', 'publish'],
        '/tournaments/organize/autumn-open?tab=results&round=generated',
        '24 entered, 1 withdrawn, waitlist empty',
      ],
    });
  });

  test('nine entrants are shown of 24', () => {
    const v = view('setup', 'entrants');
    assert({
      given: '24 entrants',
      should: 'show nine, top seeds with byes first',
      actual: [
        v.entrantsShown.length,
        v.entrantsShown[0]?.status,
        v.entrantsNote.startsWith('Showing 9 of 24.'),
      ],
      expected: [9, 'Bye', true],
    });
  });
});
