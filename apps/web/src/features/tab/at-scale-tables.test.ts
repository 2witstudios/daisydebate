import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  bracketFromLive,
  breakTables,
  clearByWinOrPoints,
} from './at-scale-tables';
import { sampleBracketView } from './sample/results';
import type { SampleScene } from './sample/scene';

setupRitewayBun();

const large = (moment: SampleScene['moment']): SampleScene => ({
  viewer: 'host',
  moment,
  scale: 'large',
});

describe('break lines', () => {
  type Row = {
    readonly entry: string;
    readonly wins: number;
    readonly points: number;
  };
  const row = (entry: string, wins: number, points: number): Row => ({
    entry,
    wins,
    points,
  });
  const whole = [
    row('A', 5, 180),
    row('B', 4, 175),
    row('C', 4, 172.5),
    row('N1', 4, 172),
    row('D', 4, 171),
    row('N2', 3, 170),
    row('N3', 3, 169),
    row('N4', 3, 168),
    row('E', 2, 160),
  ];
  const novices = whole.filter((one) => one.entry.startsWith('N'));
  const options = {
    keyOf: (one: Row) => one.entry,
    clearOf: clearByWinOrPoints(3),
    below: 2,
  };

  test('one table per break line', () => {
    const [main, novice] = breakTables(
      [
        { id: 'main', seeds: 4, rows: whole },
        { id: 'novice', seeds: 2, rows: novices },
      ],
      { ...options, open: new Set() },
    );
    assert({
      given:
        'a main break of 4 and a novice break of 2, with one novice in the main break',
      should:
        'collapse the clear rows, show the rest above the line and two below, and set the novice who broke aside',
      actual: [
        main?.clear,
        main?.near.map((one) => one.entry),
        main?.below.map((one) => one.entry),
        main?.more,
        novice?.earlier.map((one) => one.entry),
        novice?.near.map((one) => one.entry),
        novice?.below.map((one) => one.entry),
      ],
      expected: [
        { shown: [], rest: 2, total: 2 },
        ['C', 'N1'],
        ['D', 'N2'],
        3,
        ['N1'],
        ['N2', 'N3'],
        ['N4'],
      ],
    });
  });

  test('an open line shows its clear rows', () => {
    const [main] = breakTables([{ id: 'main', seeds: 4, rows: whole }], {
      ...options,
      open: new Set(['main']),
    });
    assert({
      given: 'the main break opened',
      should: 'show its clear rows',
      actual: main?.clear.shown.map((one) => one.entry),
      expected: ['A', 'B'],
    });
  });
});

describe('the bracket from the live round', () => {
  test('earlier rounds are summed up', () => {
    const bracket = sampleBracketView('autumn-open', null, large('elims'));
    const rounds = bracket?.read.tabRounds ?? [];
    const cut = bracketFromLive(rounds, { keep: 4, showEarlier: false });
    const finished = bracketFromLive(
      sampleBracketView('autumn-open', null, large('finished'))?.read
        .tabRounds ?? [],
      { keep: 4, showEarlier: false },
    );
    assert({
      given:
        'a bracket of 64 with octofinals live, the same asked for in full, and a finished one',
      should:
        'show octofinals onward and sum up 48 results with 3 upsets; show all six; keep the last four',
      actual: [
        cut.shown.map((round) => round.name),
        cut.summary,
        bracketFromLive(rounds, { keep: 4, showEarlier: true }).shown.length,
        finished.shown.map((round) => round.name),
      ],
      expected: [
        ['Octofinals', 'Quarterfinals', 'Semifinals', 'Final'],
        {
          names: ['Triple octofinals', 'Double octofinals'],
          results: 48,
          upsets: 3,
          biggest: [41, 24],
        },
        6,
        ['Octofinals', 'Quarterfinals', 'Semifinals', 'Final'],
      ],
    });
  });
});
