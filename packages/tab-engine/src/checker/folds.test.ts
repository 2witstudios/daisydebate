import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { breaks } from '../breaks';
import type { Entry } from '../shapes/competition';
import type {
  BreaksAnswer,
  BreaksInput,
  StandingsInput,
} from '../shapes/folds';
import type { ResolvedSettings } from '../shapes/settings';
import { swissPower } from '../simulate/presets';
import { standings } from '../standings';
import { entry, playEvent, twoSides } from './build.test-support';
import { checkBreaks, checkStandings } from './index';

setupRitewayBun();

const entries: readonly Entry[] = Array.from({ length: 8 }, (_, i) => ({
  ...entry(`e${i}`, null),
  division: i % 2 === 0 ? 'open' : 'novice',
}));

/** Three played rounds; the fourth round's request holds the history of all three. */
const history = (() => {
  const played = playEvent({
    label: 'folds',
    seed: 4,
    format: twoSides,
    entries,
    settings: swissPower,
    judges: null,
    rounds: 4,
  });
  const last = played[3]!.input;
  if (last.call !== 'windowed') throw new Error('expected a windowed call');
  return last.event.history;
})();

const standingsInput = (division: string | null = null): StandingsInput =>
  ({
    format: twoSides,
    entries,
    history,
    settings: swissPower,
    cutoff: 3,
    ratings: null,
    division,
    seed: new Uint8Array([1]),
  }) as StandingsInput;

const breaksInput = (
  policy: ResolvedSettings['break.double_qualifier']['value'],
  choices: Readonly<Record<string, string>> = {},
): BreaksInput => {
  const record = (({
    division: _division,
    ...rest
  }: ReturnType<typeof standingsInput>) => rest)(standingsInput());
  return {
    ...record,
    settings: {
      ...swissPower,
      'break.line': { default: { kind: 'fixed', size: 2 }, byDivision: {} },
      'break.double_qualifier': { value: policy },
    },
    stages: [
      { id: 'open-break', division: null },
      { id: 'novice-break', division: 'novice' },
    ],
    choices,
  } as BreaksInput;
};

describe('checkStandings', () => {
  test('engine standings are accepted', () => {
    assert({
      given: 'standings of three played rounds, whole and for one division',
      should: 'be accepted',
      actual: [
        checkStandings(standingsInput(), standings(standingsInput())),
        checkStandings(
          standingsInput('novice'),
          standings(standingsInput('novice')),
        ),
      ],
      expected: [
        { ok: true, violations: [] },
        { ok: true, violations: [] },
      ],
    });
  });

  test('corrupted standings are rejected', () => {
    const table = standings(standingsInput());
    const reversed = { ...table, rows: [...table.rows].reverse() };
    const [dropped, ...kept] = table.results;
    const stranger = {
      ...table,
      rows: [...table.rows, { ...table.rows[0]!, entry: 'nobody', rank: null }],
    };
    const novice = standings(standingsInput('novice'));
    const openRow = table.rows.find((r) => r.entry === 'e0')!;
    const mixed = { ...novice, rows: [...novice.rows, openRow] };
    const kinds = (v: { violations: readonly { kind: string }[] }) => [
      ...new Set(v.violations.map((x) => x.kind)),
    ];
    assert({
      given:
        'a table read upside down, a result dropped, an unknown entry, and an open entry in the novice table',
      should:
        'name the rank order, the results, the unknown entry and the division',
      actual: [
        kinds(checkStandings(standingsInput(), reversed)),
        checkStandings(standingsInput(), { ...table, results: kept })
          .violations,
        kinds(checkStandings(standingsInput(), stranger)),
        kinds(checkStandings(standingsInput('novice'), mixed)),
      ],
      expected: [
        ['standings_rank_order'],
        [{ kind: 'standings_results', missing: [dropped!], extra: [] }],
        ['standings_entry_unknown'],
        ['standings_division'],
      ],
    });
  });
});

describe('checkBreaks', () => {
  test('engine breaks are accepted', () => {
    const verdicts = (['higher', 'both', 'choice'] as const).map((policy) => {
      const input = breaksInput(policy);
      return checkBreaks(input, breaks(input)).ok;
    });
    assert({
      given: 'an open and a novice break under each double-qualifier policy',
      should: 'be accepted',
      actual: verdicts,
      expected: [true, true, true],
    });
  });

  test('corrupted breaks are rejected', () => {
    const resolved = (
      stages: { stage: string; seeds: string[] }[],
    ): BreaksAnswer => ({
      kind: 'resolved',
      stages: stages.map(({ stage, seeds }) => ({ stage, bracket: { seeds } })),
    });
    assert({
      given:
        'an open entry in the novice break, a double qualifier in both under higher, and one against its choice',
      should: 'name each',
      actual: [
        checkBreaks(
          breaksInput('both'),
          resolved([{ stage: 'novice-break', seeds: ['e1', 'e0'] }]),
        ).violations,
        checkBreaks(
          breaksInput('higher'),
          resolved([
            { stage: 'open-break', seeds: ['e1', 'e0'] },
            { stage: 'novice-break', seeds: ['e1', 'e3'] },
          ]),
        ).violations,
        checkBreaks(
          breaksInput('choice', { e1: 'novice-break' }),
          resolved([
            { stage: 'open-break', seeds: ['e1', 'e0'] },
            { stage: 'novice-break', seeds: ['e3', 'e5'] },
          ]),
        ).violations,
        checkBreaks(breaksInput('choice', { e1: 'novice-break' }), {
          kind: 'undecided',
          entries: [{ entry: 'e1', stages: ['open-break', 'novice-break'] }],
        }).violations,
      ],
      expected: [
        [
          {
            kind: 'break_entry_ineligible',
            stage: 'novice-break',
            entry: 'e0',
          },
        ],
        [
          {
            kind: 'break_entry_twice',
            entry: 'e1',
            stages: ['open-break', 'novice-break'],
          },
        ],
        [
          {
            kind: 'break_against_choice',
            stage: 'open-break',
            entry: 'e1',
            choice: 'novice-break',
          },
        ],
        [{ kind: 'undecided_has_choice', entry: 'e1', choice: 'novice-break' }],
      ],
    });
  });
});
