import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { draw } from '../draw';
import type { Fixture, Id } from '../shapes/competition';
import type {
  Draw,
  DrawAnswer,
  DrawInput,
  EventRequest,
  RuleBreak,
} from '../shapes/draw';
import type { ResolvedSettings } from '../shapes/settings';
import { randomPreset, swissPower } from '../simulate/presets';
import { seedOrder } from './bracket';
import {
  drawnOf,
  entry,
  fourSides,
  judge,
  numbers,
  playBracket,
  playEvent,
  request,
  slotCase,
  speakers,
  twoSides,
  windowed,
  type Played,
} from './build.test-support';
import { check, type Verdict, type Violation } from './index';

setupRitewayBun();

const pick = <K extends Violation['kind']>(verdict: Verdict, kind: K) =>
  verdict.violations.filter(
    (v): v is Extract<Violation, { kind: K }> => v.kind === kind,
  );

const kinds = (verdict: Verdict) =>
  [...new Set(verdict.violations.map((v) => v.kind))].sort();

const withDraw = (
  answer: DrawAnswer,
  change: (d: Draw) => Draw,
): DrawAnswer => ({ kind: 'drawn', draws: drawnOf(answer).map(change) });

const withAdd = (d: Draw, fixtures: readonly Fixture[]): Draw =>
  ({
    ...d,
    add: fixtures.map((fixture, i) => ({ ordinal: i + 1, fixture })),
  }) as Draw;

const fixturesOf = (d: Draw): Fixture[] =>
  d.add.map((a) => a.fixture as Fixture);

const rejected = (played: readonly Played[], label: string) =>
  played.flatMap(({ input, answer }, round) => {
    const verdict = check(input, answer);
    return verdict.ok
      ? []
      : [{ label, round: round + 1, violations: verdict.violations }];
  });

const ids = (n: number) => Array.from({ length: n }, (_, i) => `e${i}`);

/** Round two of a–b, c–d (a and c won) and a bye to e, under the given settings. */
const roundTwoWithBye = (settings: ResolvedSettings = swissPower) =>
  windowed(
    request({
      event: 'ev',
      entries: ['a', 'b', 'c', 'd', 'e'].map((id) => entry(id, null)),
      settings,
      tabRound: 2,
      cutoff: 1,
      history: {
        fixtures: [
          {
            id: 'h0',
            tabRound: 1,
            fixture: { kind: 'pairing', sides: ['a', 'b'], panel: [] },
          },
          {
            id: 'h1',
            tabRound: 1,
            fixture: { kind: 'pairing', sides: ['c', 'd'], panel: [] },
          },
          { id: 'h2', tabRound: 1, fixture: { kind: 'bye', entry: 'e' } },
        ],
        results: [
          ['h0', 'a'],
          ['h1', 'c'],
        ].map(([fixture, winner]) => ({
          id: `r-${fixture}`,
          fixture: fixture!,
          kind: 'decided',
          supersedes: null,
          certified: true,
          outcome: { kind: 'winner', winner: winner!, ballots: [] },
        })),
      },
    }),
    null,
  );

const pairing = (a: Id, b: Id, panel: readonly Id[] = []): Fixture => ({
  kind: 'pairing',
  sides: [a, b],
  panel,
});
const bye = (e: Id): Fixture => ({ kind: 'bye', entry: e });

describe('check: byes are counted (gap 1)', () => {
  const six = playEvent({
    label: 'byes-six',
    seed: 1,
    format: twoSides,
    entries: ids(6).map((id) => entry(id, null)),
    settings: swissPower,
    judges: null,
    rounds: 1,
  })[0]!;

  test('a two-sided pairing split into two byes', () => {
    const d = drawnOf(six.answer)[0]!;
    const [first, ...rest] = fixturesOf(d);
    if (first?.kind !== 'pairing') throw new Error('expected a pairing');
    const verdict = check(
      six.input,
      withDraw(six.answer, (x) =>
        withAdd(x, [bye(first.sides[0]), bye(first.sides[1]), ...rest]),
      ),
    );
    assert({
      given: 'an even field of six whose first pairing became two byes',
      should: 'accept the engine draw and count two byes where none is due',
      actual: [check(six.input, six.answer).ok, pick(verdict, 'bye_count')],
      expected: [
        true,
        [{ kind: 'bye_count', event: 'ev', expected: 0, actual: 2 }],
      ],
    });
  });

  test('a speaker moved out of a section into a bye', () => {
    const played = playEvent({
      label: 'byes-speech',
      seed: 2,
      format: speakers,
      entries: ids(9).map((id) => entry(id, null)),
      settings: swissPower,
      judges: null,
      rounds: 1,
    })[0]!;
    const d = drawnOf(played.answer)[0]!;
    const [first, ...rest] = fixturesOf(d);
    if (first?.kind !== 'section') throw new Error('expected a section');
    const [out, ...kept] = first.speakers;
    const verdict = check(
      played.input,
      withDraw(played.answer, (x) =>
        withAdd(x, [{ ...first, speakers: kept }, bye(out!), ...rest]),
      ),
    );
    assert({
      given: 'a speech round where one speaker takes a bye',
      should: 'accept the engine draw and reject any bye in sections',
      actual: [
        check(played.input, played.answer).ok,
        pick(verdict, 'bye_count'),
      ],
      expected: [
        true,
        [{ kind: 'bye_count', event: 'ev', expected: 0, actual: 1 }],
      ],
    });
  });

  test('four sides: the remainder over four', () => {
    const played = playEvent({
      label: 'byes-four',
      seed: 3,
      format: fourSides,
      entries: ids(10).map((id) => entry(id, null)),
      settings: swissPower,
      judges: null,
      rounds: 1,
    })[0]!;
    const d = drawnOf(played.answer)[0]!;
    const fixtures = fixturesOf(d);
    const room = fixtures.find((f) => f.kind === 'pairing')!;
    const verdict = check(
      played.input,
      withDraw(played.answer, (x) =>
        withAdd(x, [
          ...fixtures.filter((f) => f !== room),
          ...(room.kind === 'pairing' ? room.sides.map(bye) : []),
        ]),
      ),
    );
    assert({
      given: 'a ten-entry four-side round with one room broken into four byes',
      should:
        'accept the engine draw (two byes) and count six in the corrupt one',
      actual: [
        check(played.input, played.answer).ok,
        fixtures.filter((f) => f.kind === 'bye').length,
        pick(verdict, 'bye_count'),
      ],
      expected: [
        true,
        2,
        [{ kind: 'bye_count', event: 'ev', expected: 2, actual: 6 }],
      ],
    });
  });
});

describe('check: the effective cutoff (gap 2)', () => {
  test('engine draws under a lag, and a prematched round, are accepted', () => {
    const lagged: ResolvedSettings = {
      ...swissPower,
      'pairing.method': {
        ...swissPower['pairing.method'],
        preliminary: { ...swissPower['pairing.method'].preliminary, lag: 1 },
      },
    };
    const found = [
      ...rejected(
        playEvent({
          label: 'lag',
          seed: 5,
          format: twoSides,
          entries: ids(8).map((id) => entry(id, null)),
          settings: lagged,
          judges: null,
          rounds: 4,
        }),
        'lag 1',
      ),
      ...rejected(
        playEvent({
          label: 'prematched',
          seed: 5,
          format: twoSides,
          entries: ids(7).map((id) => entry(id, null)),
          settings: randomPreset,
          judges: null,
          rounds: 3,
        }),
        'prematched',
      ),
    ];
    assert({
      given: 'a power-paired event read one round back, and a prematched event',
      should: 'accept every engine draw',
      actual: found,
      expected: [],
    });
  });

  test('a record whose cutoff is the caller’s, not the effective one', () => {
    const played = playEvent({
      label: 'lag-record',
      seed: 6,
      format: twoSides,
      entries: ids(6).map((id) => entry(id, null)),
      settings: randomPreset,
      judges: null,
      rounds: 2,
    })[1]!;
    const d = drawnOf(played.answer)[0]!;
    const verdict = check(
      played.input,
      withDraw(
        played.answer,
        (x) => ({ ...x, inputs: { ...x.inputs, cutoff: 1 } }) as Draw,
      ),
    );
    assert({
      given:
        'a prematched second round (which reads no result) recording cutoff 1',
      should: 'name the effective cutoff 0',
      actual: [
        d.inputs.cutoff,
        d.inputs.results,
        pick(verdict, 'inputs_cutoff'),
      ],
      expected: [
        0,
        [],
        [{ kind: 'inputs_cutoff', event: 'ev', expected: 0, actual: 1 }],
      ],
    });
  });
});

describe('check: brackets (gap 3)', () => {
  test('the standard seeded tree', () => {
    const pairs = (size: number) => {
      const order = seedOrder(size);
      return Array.from({ length: size / 2 }, (_, i) =>
        [order[2 * i]!, order[2 * i + 1]!].sort((a, b) => a - b).join('v'),
      );
    };
    assert({
      given: 'brackets of 8 and 16',
      should: 'pair seeds in the standard order',
      actual: [pairs(8), pairs(16)],
      expected: [
        ['1v8', '4v5', '3v6', '2v7'],
        ['1v16', '8v9', '5v12', '4v13', '3v14', '6v11', '7v10', '2v15'],
      ],
    });
  });

  test('engine brackets are accepted through the final', () => {
    const found = [];
    for (let n = 2; n <= 17; n += 1)
      for (let seed = 0; seed < 4; seed += 1)
        found.push(
          ...rejected(
            playBracket({
              label: 'bracket-two',
              seed,
              format: twoSides,
              entries: ids(n).map((id) => entry(id, null)),
              settings: swissPower,
              judges: null,
              rounds: Math.ceil(Math.log2(n)),
              doubleLoss: true,
            }),
            `two ${n}/${seed}`,
          ),
        );
    for (const [format, n] of [
      [fourSides, 10],
      [fourSides, 13],
      [speakers, 13],
      [speakers, 20],
    ] as const)
      for (let seed = 0; seed < 3; seed += 1)
        found.push(
          ...rejected(
            playBracket({
              label: 'bracket-ranked',
              seed,
              format,
              entries: ids(n).map((id) => entry(id, null)),
              settings: swissPower,
              judges: null,
              rounds: 4,
            }),
            `${format.outcome} ${n}/${seed}`,
          ),
        );
    assert({
      given:
        'two-sided brackets of 2 to 17 with double losses, four-side and speech brackets',
      should: 'accept every engine draw',
      actual: found,
      expected: [],
    });
  });

  const eight = playBracket({
    label: 'bracket-eight',
    seed: 1,
    format: twoSides,
    entries: ids(8).map((id) => entry(id, null)),
    settings: swissPower,
    judges: null,
    rounds: 2,
  });

  test('a first round off the tree', () => {
    const { input, answer } = eight[0]!;
    const corrupt = withDraw(answer, (x) =>
      withAdd(x, [
        pairing('e0', 'e1'),
        pairing('e3', 'e4'),
        pairing('e2', 'e5'),
        pairing('e6', 'e7'),
      ]),
    );
    assert({
      given: 'an eight-seed first round pairing 1v2 and 7v8',
      should: 'name the tree’s fixtures missing and the drawn ones extra',
      actual: pick(check(input, corrupt), 'bracket_mismatch'),
      expected: [
        {
          kind: 'bracket_mismatch',
          event: 'ev',
          missing: ['e0 v e7', 'e1 v e6'],
          extra: ['e0 v e1', 'e6 v e7'],
        },
      ],
    });
  });

  test('a second round that advances a loser', () => {
    const { input, answer } = eight[1]!;
    const d = drawnOf(answer)[0]!;
    const [first, ...rest] = fixturesOf(d);
    if (first?.kind !== 'pairing') throw new Error('expected a pairing');
    const history = input.call === 'windowed' ? input.event.history : null;
    const loser = history!.fixtures
      .map((f) => f.fixture as Fixture)
      .flatMap((f) => (f.kind === 'pairing' ? f.sides : []))
      .find(
        (e) =>
          !d.add.some(
            (a) =>
              (a.fixture as Fixture).kind === 'pairing' &&
              (a.fixture as { sides: readonly Id[] }).sides.includes(e),
          ),
      )!;
    const corrupt = withDraw(answer, (x) =>
      withAdd(x, [pairing(first.sides[0], loser), ...rest]),
    );
    assert({
      given: 'a second round with a first-round loser in place of a winner',
      should: 'accept the engine round and reject the corrupt one',
      actual: [
        check(input, answer).ok,
        pick(check(input, corrupt), 'bracket_mismatch').length,
      ],
      expected: [true, 1],
    });
  });

  test('an unknown and a withdrawn entry in a bracket', () => {
    const { input, answer } = eight[0]!;
    const withdrawn: DrawInput =
      input.call === 'windowed'
        ? {
            ...input,
            event: {
              ...input.event,
              entries: input.event.entries.map((e) =>
                e.id === 'e7' ? { ...e, status: 'withdrawn' } : e,
              ),
            } as EventRequest,
          }
        : input;
    const d = drawnOf(answer)[0]!;
    const corrupt = withDraw(answer, (x) =>
      withAdd(
        x,
        fixturesOf(d).map((f) =>
          f.kind === 'pairing' && f.sides.includes('e3')
            ? pairing('zz', f.sides[1])
            : f,
        ),
      ),
    );
    assert({
      given:
        'a first round naming an entry the event lacks, and one holding a withdrawn seed',
      should: 'name the unknown entry and the withdrawn one',
      actual: [
        pick(check(input, corrupt), 'entry_unknown').map((v) => v.entry),
        pick(check(withdrawn, answer), 'withdrawn_entry_placed').map(
          (v) => v.entry,
        ),
      ],
      expected: [['zz'], ['e7']],
    });
  });

  test('a drawn round where a needed result is missing', () => {
    const { input, answer } = eight[1]!;
    if (input.call !== 'windowed') throw new Error('expected windowed');
    const h = input.event.history;
    const victim = h.results[0]!.fixture;
    const short: DrawInput = {
      ...input,
      event: {
        ...input.event,
        history: {
          ...h,
          results: h.results.filter((r) => r.fixture !== victim),
        },
      } as EventRequest,
    };
    const engine = draw(short);
    assert({
      given: 'a second round whose history lacks a first-round result',
      should:
        'agree with the engine’s missing result, and reject a draw made anyway',
      actual: [
        engine.kind,
        check(short, engine).ok,
        pick(check(short, answer), 'bracket_result_missing'),
      ],
      expected: [
        'infeasible',
        true,
        [{ kind: 'bracket_result_missing', event: 'ev', fixtures: [victim] }],
      ],
    });
  });
});

describe('check: optimality with judges (gap 4)', () => {
  test('a worse pairing with panels seated', () => {
    const input = windowed(
      request({
        event: 'ev',
        entries: ['a', 'b', 'c', 'd'].map((id) => entry(id, null)),
        settings: swissPower,
        tabRound: 2,
        cutoff: 1,
        history: {
          fixtures: [
            {
              id: 'h0',
              tabRound: 1,
              fixture: { kind: 'pairing', sides: ['a', 'b'], panel: [] },
            },
            {
              id: 'h1',
              tabRound: 1,
              fixture: { kind: 'pairing', sides: ['c', 'd'], panel: [] },
            },
          ],
          results: [
            ['h0', 'a'],
            ['h1', 'c'],
          ].map(([fixture, winner]) => ({
            id: `r-${fixture}`,
            fixture: fixture!,
            kind: 'decided',
            supersedes: null,
            certified: true,
            outcome: { kind: 'winner', winner: winner!, ballots: [] },
          })),
        },
      }),
      [judge('j0'), judge('j1')],
    );
    const answer = draw(input);
    const worse = withDraw(answer, (x) =>
      withAdd(x, [pairing('a', 'd', ['j0']), pairing('c', 'b', ['j1'])]),
    );
    assert({
      given: 'winners paired down against losers, with every panel seated',
      should: 'accept the engine draw and find the better plan',
      actual: [
        check(input, answer).ok,
        pick(check(input, worse), 'not_optimal').length,
      ],
      expected: [true, 1],
    });
  });
});

describe('check: the bye recipient (gap 5)', () => {
  const input = roundTwoWithBye();
  const answer = draw(input);
  const byeTo = (entry: Id, ...pairs: (readonly [Id, Id])[]) =>
    check(
      input,
      withDraw(answer, (x) =>
        withAdd(x, [bye(entry), ...pairs.map(([a, b]) => pairing(a, b))]),
      ),
    );

  test('the engine bye goes to a loser without a bye', () => {
    const d = drawnOf(answer)[0]!;
    assert({
      given: 'a and c won, b and d lost, e had the bye',
      should: 'give the bye to b or d, and be accepted',
      actual: [
        fixturesOf(d).some(
          (f) => f.kind === 'bye' && (f.entry === 'b' || f.entry === 'd'),
        ),
        check(input, answer).ok,
      ],
      expected: [true, true],
    });
  });

  test('the bye to a winner', () => {
    assert({
      given: 'the bye given to a, who won, while b and d have none',
      should: 'name a as not having the fewest wins',
      actual: pick(byeTo('a', ['c', 'b'], ['d', 'e']), 'bye_recipient'),
      expected: [
        {
          kind: 'bye_recipient',
          event: 'ev',
          entry: 'a',
          fixture: { kind: 'new', ordinal: 1 },
          reason: 'not_fewest_wins',
        },
      ],
    });
  });

  test('the bye again to e', () => {
    assert({
      given: 'a second bye to e under a bye-repeat rule',
      should: 'name e as having had a bye',
      actual: pick(byeTo('e', ['a', 'c'], ['b', 'd']), 'bye_recipient').map(
        (v) => [v.entry, v.reason],
      ),
      expected: [['e', 'repeat_bye']],
    });
  });

  test('random recipients: only who may take it', () => {
    const random = roundTwoWithBye({
      ...swissPower,
      'bye.recipient': { value: 'random' },
    });
    const winner = withDraw(draw(random), (x) =>
      withAdd(x, [bye('a'), pairing('c', 'b'), pairing('d', 'e')]),
    );
    assert({
      given: 'a bye to a winner when the recipient is drawn at random',
      should: 'not question the wins',
      actual: pick(check(random, winner), 'bye_recipient'),
      expected: [],
    });
  });

  test('a kept movable bye is never questioned', () => {
    const base = roundTwoWithBye();
    const kept: DrawInput =
      base.call === 'windowed'
        ? {
            ...base,
            event: {
              ...base.event,
              existing: [{ id: 'x1', hold: 'movable', fixture: bye('a') }],
            } as EventRequest,
          }
        : base;
    const answer = draw(kept);
    assert({
      given: 'a movable bye to a winner, which the engine keeps',
      should: 'accept the draw',
      actual: [
        drawnOf(answer)[0]!.keep.map((k) => k.id),
        pick(check(kept, answer), 'bye_recipient'),
      ],
      expected: [['x1'], []],
    });
  });
});

describe('check: infeasible and unresolved answers are checked (gap 6)', () => {
  const sixJudged = (judges: number) =>
    windowed(
      request({
        event: 'ev',
        entries: ids(6).map((id) => entry(id, null)),
        settings: swissPower,
      }),
      Array.from({ length: judges }, (_, i) => judge(`j${i}`)),
    );

  test('panels: a real shortage is accepted', () => {
    const input = sixJudged(2);
    const answer = draw(input);
    assert({
      given: 'three pairings and two judges',
      should: 'be declared short of panels, and the checker agree',
      actual: [answer.kind, check(input, answer)],
      expected: ['infeasible', { ok: true, violations: [] }],
    });
  });

  test('panels: a claimed shortage the judges could fill', () => {
    const short = draw(sixJudged(2));
    if (short.kind !== 'infeasible' || short.cause !== 'panels')
      throw new Error('expected a panel shortage');
    const verdict = check(sixJudged(3), short);
    assert({
      given: 'the same shortage claimed with three judges for three seats',
      should: 'reject the claim',
      actual: pick(verdict, 'infeasible_panels_unfounded'),
      expected: [{ kind: 'infeasible_panels_unfounded', open: 3, fillable: 3 }],
    });
  });

  test('panels: a judging rule really does empty a seat', () => {
    const input = windowed(
      request({
        event: 'ev',
        entries: [entry('a', 's0'), entry('b', 's0')],
        settings: swissPower,
      }),
      [judge('j0', { protection: [{ scope: 'school', key: 's0' }] })],
    );
    const answer = draw(input);
    assert({
      given:
        'one pairing and one judge of the same school, under a school rule',
      should: 'be short of panels, and the checker agree by its own flow',
      actual: [answer.kind, check(input, answer).ok],
      expected: ['infeasible', true],
    });
  });

  test('unresolved: the attempt and its broken list are checked', () => {
    const next = numbers('field', 0);
    const played = playEvent({
      label: 'four',
      seed: 0,
      format: fourSides,
      entries: ids(8).map((id) =>
        entry(id, next(3) === 0 ? null : `s${next(3)}`),
      ),
      settings: swissPower,
      judges: Array.from({ length: 3 }, (_, i) => judge(`j${i}`)),
      rounds: 2,
    })[1]!;
    const answer = played.answer;
    if (answer.kind !== 'unresolved') throw new Error('expected unresolved');
    const [dropped, ...broken] = answer.broken;
    const fewer = check(played.input, { ...answer, broken });
    const doubled = check(played.input, {
      ...answer,
      attempt: {
        ...answer.attempt,
        add: answer.attempt.add.slice(0, 1),
      } as Draw,
    });
    assert({
      given:
        'an engine unresolved answer, the same with one break unlisted, and with its attempt short of a room',
      should:
        'accept the first, name the unlisted break, and name the entries not placed',
      actual: [
        check(played.input, answer).ok,
        pick(fewer, 'unresolved_broken').map((v) => v.missing),
        pick(fewer, 'rule_broken').length,
        pick(doubled, 'entry_not_placed').length,
      ],
      expected: [true, [[dropped as RuleBreak]], 1, 4],
    });
  });

  test('structure: a claimed missing result on a complete record', () => {
    const { input } = playBracket({
      label: 'bracket-eight',
      seed: 1,
      format: twoSides,
      entries: ids(8).map((id) => entry(id, null)),
      settings: swissPower,
      judges: null,
      rounds: 2,
    })[1]!;
    const verdict = check(input, {
      kind: 'infeasible',
      cause: 'structure',
      event: 'ev',
      fact: 'missing_result',
      fixture: 'ev-t1-1',
    });
    assert({
      given:
        'a second elimination round with every result in, claimed missing one',
      should: 'reject the claim',
      actual: verdict.violations,
      expected: [
        {
          kind: 'infeasible_structure_unfounded',
          event: 'ev',
          fixture: 'ev-t1-1',
        },
      ],
    });
  });
});

describe('check: the assessment is recounted in full (gap 7)', () => {
  const next = numbers('gap7', 0);
  const played = playEvent({
    label: 'gap7',
    seed: 3,
    format: twoSides,
    entries: ids(6).map((id) => entry(id, `s${next(2)}`)),
    settings: {
      ...swissPower,
      'pairing.same_school': { force: 'warning' },
    },
    judges: Array.from({ length: 4 }, (_, i) =>
      judge(`j${i}`, { outstandingBallots: i % 2 }),
    ),
    rounds: 3,
  })[2]!;
  const d = drawnOf(played.answer)[0]!;
  const assessed = (change: (a: Draw['assessment']) => Draw['assessment']) =>
    check(
      played.input,
      withDraw(played.answer, (x) => ({
        ...x,
        assessment: change(x.assessment),
      })),
    );

  test('the base draw is clean and carries warnings', () => {
    assert({
      given: 'a third round with schoolmates and judges owing ballots',
      should: 'be accepted, with warnings to compare',
      actual: [
        check(played.input, played.answer).ok,
        d.assessment.warnings.length > 0,
      ],
      expected: [true, true],
    });
  });

  test('a total left out', () => {
    const verdict = assessed((a) => ({
      ...a,
      totals: a.totals.filter((t) => t.key !== 'pairing.pull_up'),
    }));
    assert({
      given: 'a draw whose pull-up total (above zero) is missing',
      should: 'name the missing total',
      actual: [
        d.assessment.totals.find((t) => t.key === 'pairing.pull_up')?.cost,
        pick(verdict, 'cost_total').map((v) => [v.key, v.actual]),
      ],
      expected: [[4, 3], [['pairing.pull_up', null]]],
    });
  });

  test('the pull-up count field', () => {
    const verdict = assessed((a) => ({
      ...a,
      fixtures: a.fixtures.map((f, i) =>
        i === 0
          ? {
              ...f,
              terms: f.terms.map((t) =>
                t.key === 'pairing.pull_up'
                  ? { ...t, cost: [t.cost[0]!, t.cost[1]! + 2] }
                  : t,
              ),
            }
          : f,
      ),
    }));
    assert({
      given: 'a first fixture claiming two more earlier pull-ups than it has',
      should: 'name the pull-up term',
      actual: pick(verdict, 'cost_term').map((v) => v.key),
      expected: ['pairing.pull_up'],
    });
  });

  test('the break lists', () => {
    const fake: RuleBreak = {
      event: 'ev',
      key: 'pairing.rematch',
      fixture: { kind: 'new', ordinal: 1 },
    };
    const [warned, ...rest] = d.assessment.warnings;
    const verdict = assessed((a) => ({
      ...a,
      broken: [...a.broken, fake],
      warnings: rest,
      invalid: [{ fact: 'judge_twice', judge: 'j0' }],
    }));
    assert({
      given:
        'a draw listing a rule break it lacks, dropping a warning, and listing an invalid fact',
      should: 'name each',
      actual: [
        pick(verdict, 'assessment_broken').map((v) => v.extra),
        pick(verdict, 'assessment_warnings').map((v) => v.missing),
        pick(verdict, 'assessment_invalid').length,
      ],
      expected: [[[fake]], [[warned!]], 1],
    });
  });
});

describe('check: the rest of the inputs record (gap 8)', () => {
  test('seed, call, alongside and ratings', () => {
    const input = slotCase();
    const answer = draw(input);
    const verdict = check(
      input,
      withDraw(answer, (x) => {
        if (x.inputs.call !== 'slot') throw new Error('expected slot');
        return x.event === 'debate'
          ? ({
              ...x,
              inputs: {
                ...x.inputs,
                seed: 'ff',
                alongside: [],
                ratings: { ladder: 'l', takenAt: 't', calculation: 'c' },
              },
            } as Draw)
          : ({ ...x, inputs: { ...x.inputs, call: 'windowed' } } as Draw);
      }),
    );
    assert({
      given:
        'a slot draw recording the wrong seed, no alongside event and a rating, and one recorded as windowed',
      should: 'name each',
      actual: [
        check(input, answer).ok,
        kinds(verdict),
        pick(verdict, 'inputs_seed').map((v) => v.expected),
        pick(verdict, 'inputs_alongside').map((v) => v.missing),
      ],
      expected: [
        true,
        ['inputs_alongside', 'inputs_call', 'inputs_ratings', 'inputs_seed'],
        ['03'],
        [['speech:1']],
      ],
    });
  });
});

describe('check: a judge never sits on their own entry', () => {
  test('windowed', () => {
    const played = playEvent({
      label: 'competing',
      seed: 1,
      format: twoSides,
      entries: ids(4).map((id) => entry(id, null)),
      settings: swissPower,
      judges: [judge('j0'), judge('j1')],
      rounds: 1,
    })[0]!;
    const d = drawnOf(played.answer)[0]!;
    const fixture = fixturesOf(d).find(
      (f) => f.kind === 'pairing' && f.panel.length > 0,
    )!;
    if (fixture.kind !== 'pairing') throw new Error('expected a pairing');
    const judgeId = fixture.panel[0]!;
    const input = played.input;
    if (input.call !== 'windowed') throw new Error('expected windowed');
    const competing: DrawInput = {
      ...input,
      judges: input.judges!.map((j) =>
        j.id === judgeId ? { ...j, person: `${fixture.sides[0]}-p` } : j,
      ),
    };
    assert({
      given: 'a judge who is a member of an entry in the fixture they judge',
      should: 'name the judge competing',
      actual: pick(check(competing, played.answer), 'judge_competing').map(
        (v) => [v.judge, v.person],
      ),
      expected: [[judgeId, `${fixture.sides[0]}-p`]],
    });
  });
});
