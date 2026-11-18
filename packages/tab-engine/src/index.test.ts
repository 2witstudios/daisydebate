import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  assess,
  breaks,
  draw,
  entryRating,
  forceKeys,
  ladderInput,
  seasonStandings,
  standings,
  whyNot,
  type BreaksInput,
  type DrawInput,
  type Entry,
  type ForceKey,
  type Plan,
  type ResolvedSettings,
  type SlotJudge,
  type StandingsInput,
} from './index';
import { swissPower } from './simulate/presets';

setupRitewayBun();

/** The public entry points, end to end, as the wiring will call them. */
const field: Entry[] = Array.from({ length: 6 }, (_, i) => ({
  id: `entry-${i}`,
  members: [`person-${i}`],
  protection: [{ scope: 'school', key: `school-${i % 3}` }],
  division: i % 2 === 0 ? 'novice' : null,
  status: 'active',
  breakEligible: true,
}));
const judges: SlotJudge[] = Array.from({ length: 3 }, (_, i) => ({
  id: `judge-${i}`,
  person: `judge-person-${i}`,
  protection: [],
  events: null,
  conflicts: [],
  strikes: [],
  judged: [],
  tabRoundsJudged: 0,
  outstandingBallots: 0,
  chair: true,
  available: true,
}));
const settings: ResolvedSettings = swissPower;
const input: DrawInput = {
  call: 'slot',
  slot: 'slot-1',
  events: [
    {
      event: 'event-1',
      format: { outcome: 'winner', sides: 2 },
      stage: { kind: 'preliminary' },
      tabRound: 1,
      entries: field,
      history: { fixtures: [], results: [] },
      settings,
      cutoff: 0,
      ratings: null,
      existing: [],
    },
  ],
  judges,
  commitments: [],
  seed: new Uint8Array(32).fill(9),
};
const fold: StandingsInput = {
  format: { outcome: 'winner', sides: 2 },
  entries: field,
  history: { fixtures: [], results: [] },
  settings,
  cutoff: 0,
  ratings: null,
  division: null,
  seed: input.seed,
};

describe('@daisy/tab-engine', () => {
  test('draws, assesses and explains one slot', () => {
    const answer = draw(input);
    const d = answer.kind === 'drawn' ? answer.draws[0]! : null;
    const plan =
      d &&
      ({
        event: d.event,
        keep: d.keep,
        add: d.add,
        withdraw: d.withdraw,
      } as Plan);
    assert({
      given: 'six entries and three judges in one slot',
      should:
        'draw three pairings with a judge each, cost the plan as drawn, and answer a why-not',
      actual: [
        d?.add.length,
        plan &&
          JSON.stringify(assess(input, [plan])[0]) ===
            JSON.stringify(d?.assessment),
        whyNot(input, 'event-1', ['entry-0', 'entry-1']).kind,
      ],
      expected: [3, true, 'answered'],
    });
  });

  test('folds standings, breaks, the season and the ladder input', () => {
    const breakInput: BreaksInput = {
      ...fold,
      stages: [{ id: 'final', division: null }],
      choices: {},
    };
    const broken = breaks(breakInput);
    assert({
      given: 'an event with no results yet',
      should:
        'list every entry, break all six, rate a pair, and fold an empty season and ladder',
      actual: [
        standings(fold).rows.length,
        broken.kind === 'resolved'
          ? broken.stages[0]!.bracket.seeds.length
          : broken.kind,
        entryRating([
          { status: 'rated', rating: 1500, deviation: 100 },
          { status: 'rated', rating: 1601, deviation: 101 },
        ]),
        seasonStandings([], {
          preliminaryWin: { points: 1, cap: null },
          eliminationRound: { points: 2 },
          bestEvents: null,
          topPerSchool: null,
        }).rows,
        ladderInput({ rooms: [], tournaments: [] }),
      ],
      expected: [
        6,
        6,
        { status: 'rated', rating: 1550, deviation: 100 },
        [],
        [],
      ],
    });
  });

  test('names every force key the catalogue names', () => {
    const keys: ForceKey[] = Object.keys(forceKeys) as ForceKey[];
    assert({
      given: 'the engine registry',
      should: 'hold the seventeen force keys',
      actual: keys.length,
      expected: 17,
    });
  });
});
