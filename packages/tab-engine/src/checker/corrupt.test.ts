import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { draw } from '../draw';
import type { Fixture, Id } from '../shapes/competition';
import type { Draw, DrawAnswer, DrawInput, NewFixture } from '../shapes/draw';
import { swissPower } from '../simulate/presets';
import {
  drawnOf,
  entry,
  judge,
  numbers,
  playEvent,
  request,
  sharedPerson,
  slotCase,
  twoSides,
  windowed,
} from './build.test-support';
import { check, type Verdict, type Violation } from './index';

setupRitewayBun();

const pick = <K extends Violation['kind']>(verdict: Verdict, kind: K) =>
  verdict.violations.filter(
    (v): v is Extract<Violation, { kind: K }> => v.kind === kind,
  );

const withDraw = (
  answer: DrawAnswer,
  change: (d: Draw) => Draw,
): DrawAnswer => ({
  kind: 'drawn',
  draws: drawnOf(answer).map(change),
});

type Added = NewFixture<typeof twoSides>;
const pairingAt = (d: Draw, i: number) => {
  const fixture = d.add[i]!.fixture as Fixture;
  if (fixture.kind !== 'pairing') throw new Error('expected a pairing');
  return fixture;
};
const replaceAdd = (d: Draw, i: number, fixture: Fixture): Draw =>
  ({
    ...d,
    add: d.add.map((a, j) =>
      j === i ? { ...a, fixture } : a,
    ) as readonly Added[],
  }) as Draw;

/** A played third round of six power-paired entries with judges: three pairings, no byes. */
const third = (() => {
  const next = numbers('corrupt-field', 0);
  const entries = Array.from({ length: 6 }, (_, i) =>
    entry(`e${i}`, `s${next(3)}`),
  );
  const judges = Array.from({ length: 4 }, (_, i) =>
    judge(`j${i}`, { chair: i !== 1 }),
  );
  const played = playEvent({
    label: 'corrupt',
    seed: 2,
    format: twoSides,
    entries,
    settings: swissPower,
    judges,
    rounds: 3,
  });
  return played[2]!;
})();

/** A second round where pairing a–c is fixed with judge j0 seated, and b–d is movable. */
const existingCase = (() => {
  const history = {
    fixtures: [
      ['a', 'b'],
      ['c', 'd'],
      ['e', 'f'],
    ].map(([x, y], i) => ({
      id: `h${i}`,
      tabRound: 1,
      fixture: {
        kind: 'pairing' as const,
        sides: [x!, y!] as [Id, Id],
        panel: [],
      },
    })),
    results: ['a', 'c', 'e'].map((winner, i) => ({
      id: `r${i}`,
      fixture: `h${i}`,
      kind: 'decided' as const,
      supersedes: null,
      certified: true,
      outcome: { kind: 'winner' as const, winner, ballots: [] },
    })),
  };
  const input = windowed(
    request({
      event: 'ev',
      entries: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => entry(id, null)),
      settings: swissPower,
      tabRound: 2,
      cutoff: 1,
      history,
      existing: [
        {
          id: 'x1',
          hold: 'fixed',
          fixture: { kind: 'pairing', sides: ['a', 'c'], panel: ['j0'] },
        },
        {
          id: 'x2',
          hold: 'movable',
          fixture: { kind: 'pairing', sides: ['b', 'd'], panel: [] },
        },
      ],
    }),
    [judge('j0'), judge('j1'), judge('j2')],
  );
  return { input, answer: draw(input), history };
})();

describe('check: corrupted draws are rejected', () => {
  test('the base answers are clean', () => {
    assert({
      given: 'the engine draws the corruptions start from',
      should: 'be accepted',
      actual: [
        check(third.input, third.answer).ok,
        check(existingCase.input, existingCase.answer).ok,
      ],
      expected: [true, true],
    });
  });

  test('an entry placed twice', () => {
    const d = drawnOf(third.answer)[0]!;
    const first = pairingAt(d, 0);
    const second = pairingAt(d, 1);
    const corrupt = withDraw(third.answer, (x) =>
      replaceAdd(x, 1, { ...second, sides: [first.sides[0], second.sides[1]] }),
    );
    const verdict = check(third.input, corrupt);
    assert({
      given: 'a draw where the second pairing repeats an entry of the first',
      should: 'name the entry placed twice and the entry left out',
      actual: [
        pick(verdict, 'entry_placed_twice'),
        pick(verdict, 'entry_not_placed'),
      ],
      expected: [
        [
          {
            kind: 'entry_placed_twice',
            event: 'ev',
            entry: first.sides[0],
            fixture: { kind: 'new', ordinal: d.add[1]!.ordinal },
          },
        ],
        [{ kind: 'entry_not_placed', event: 'ev', entry: second.sides[0] }],
      ],
    });
  });

  test('an active entry missing', () => {
    const d = drawnOf(third.answer)[0]!;
    const dropped = pairingAt(d, 2);
    const verdict = check(
      third.input,
      withDraw(third.answer, (x) => ({ ...x, add: x.add.slice(0, 2) }) as Draw),
    );
    assert({
      given: 'a draw with its last pairing dropped',
      should: 'name both entries as not placed',
      actual: pick(verdict, 'entry_not_placed')
        .map((v) => v.entry)
        .sort(),
      expected: [...dropped.sides].sort(),
    });
  });

  test('a person in two fixtures of a slot, via a commitment', () => {
    const answer = draw(slotCase());
    const debate = drawnOf(answer).find((d) => d.event === 'debate')!;
    const at = debate.add.find((a) => a.fixture.kind === 'pairing')!;
    const debater = (at.fixture as { sides: readonly Id[] }).sides[0]!;
    const verdict = check(
      slotCase({ commitmentPeople: [`${debater}-p`] }),
      answer,
    );
    assert({
      given:
        'a slot draw checked against a commitment that holds a placed debater',
      should: 'name the person held by the fixture and the commitment',
      actual: pick(verdict, 'person_twice_in_slot'),
      expected: [
        {
          kind: 'person_twice_in_slot',
          person: `${debater}-p`,
          holders: [
            {
              kind: 'fixture',
              event: 'debate',
              fixture: { kind: 'new', ordinal: at.ordinal },
            },
            { kind: 'commitment', event: 'other', fixture: 'other-1' },
          ],
        },
      ],
    });
  });

  test('a person in two fixtures of a slot, via two events sharing a member', () => {
    const answer = draw(slotCase());
    const verdict = check(slotCase({ share: true }), answer);
    assert({
      given:
        'a slot draw where a debater in a pairing is also a speaker in a section',
      should: 'name the shared person',
      actual: pick(verdict, 'person_twice_in_slot').map((v) => [
        v.person,
        v.holders.map((h) => h.event),
      ]),
      expected: [[sharedPerson, ['debate', 'speech']]],
    });
  });

  test('a fixed fixture changed', () => {
    const verdict = check(
      existingCase.input,
      withDraw(
        existingCase.answer,
        (d) =>
          ({
            ...d,
            keep: d.keep.map((k) =>
              k.id === 'x1'
                ? { ...k, fixture: { ...k.fixture, sides: ['c', 'a'] } }
                : k,
            ),
          }) as Draw,
      ),
    );
    assert({
      given: 'the fixed pairing a–c kept with its sides swapped',
      should: 'name the changed fixture',
      actual: pick(verdict, 'kept_fixture_changed'),
      expected: [{ kind: 'kept_fixture_changed', event: 'ev', fixture: 'x1' }],
    });
  });

  test('a fixed fixture withdrawn', () => {
    const verdict = check(
      existingCase.input,
      withDraw(existingCase.answer, (d) => {
        const fixed = d.keep.find((k) => k.id === 'x1')!;
        return {
          ...d,
          keep: d.keep.filter((k) => k.id !== 'x1'),
          withdraw: [...d.withdraw, 'x1'],
          add: [...d.add, { ordinal: 9, fixture: fixed.fixture }],
        } as Draw;
      }),
    );
    assert({
      given: 'the fixed pairing withdrawn and drawn again as new',
      should: 'name the fixed fixture withdrawn',
      actual: pick(verdict, 'fixed_fixture_withdrawn'),
      expected: [
        { kind: 'fixed_fixture_withdrawn', event: 'ev', fixture: 'x1' },
      ],
    });
  });

  test('a seated judge removed', () => {
    const verdict = check(
      existingCase.input,
      withDraw(
        existingCase.answer,
        (d) =>
          ({
            ...d,
            keep: d.keep.map((k) =>
              k.id === 'x1'
                ? { ...k, fixture: { ...k.fixture, panel: [] } }
                : k,
            ),
          }) as Draw,
      ),
    );
    assert({
      given: 'the fixed pairing kept without the judge seated on it',
      should: 'name the judge and seat removed',
      actual: pick(verdict, 'seated_judge_removed'),
      expected: [
        {
          kind: 'seated_judge_removed',
          event: 'ev',
          fixture: 'x1',
          seat: 0,
          judge: 'j0',
        },
      ],
    });
  });

  test('a judge on two fixtures', () => {
    const d = drawnOf(third.answer)[0]!;
    const first = pairingAt(d, 0);
    const verdict = check(
      third.input,
      withDraw(third.answer, (x) =>
        replaceAdd(x, 1, { ...pairingAt(x, 1), panel: first.panel }),
      ),
    );
    assert({
      given: 'a draw seating the first pairing’s judge on the second as well',
      should: 'name the judge and both fixtures',
      actual: pick(verdict, 'judge_twice'),
      expected: [
        {
          kind: 'judge_twice',
          judge: first.panel[0]!,
          at: [
            {
              kind: 'fixture',
              event: 'ev',
              fixture: { kind: 'new', ordinal: d.add[0]!.ordinal },
            },
            {
              kind: 'fixture',
              event: 'ev',
              fixture: { kind: 'new', ordinal: d.add[1]!.ordinal },
            },
          ],
        },
      ],
    });
  });

  test('a section in a two-sided draw', () => {
    const d = drawnOf(third.answer)[0]!;
    const first = pairingAt(d, 0);
    const verdict = check(
      third.input,
      withDraw(third.answer, (x) =>
        replaceAdd(x, 0, {
          kind: 'section',
          speakers: first.sides,
          panel: first.panel,
        }),
      ),
    );
    assert({
      given: 'a two-sided draw holding a section',
      should: 'name the fixture whose kind does not fit the format',
      actual: pick(verdict, 'fixture_kind'),
      expected: [
        {
          kind: 'fixture_kind',
          event: 'ev',
          fixture: { kind: 'new', ordinal: d.add[0]!.ordinal },
        },
      ],
    });
  });

  test('a rematch under a rematch rule', () => {
    const d = drawnOf(existingCase.answer)[0]!;
    const verdict = check(
      existingCase.input,
      withDraw(
        existingCase.answer,
        (x) =>
          ({
            ...x,
            add: [
              {
                ordinal: 1,
                fixture: {
                  kind: 'pairing',
                  sides: ['b', 'd'],
                  panel: [pairingAt(d, 0).panel[0]!],
                },
              },
              {
                ordinal: 2,
                fixture: {
                  kind: 'pairing',
                  sides: ['e', 'f'],
                  panel: [pairingAt(d, 1).panel[0]!],
                },
              },
            ],
          }) as Draw,
      ),
    );
    assert({
      given:
        'a draw that pairs e and f again, who met in the first round, under a rematch rule',
      should: 'name the rematch rule broken at that fixture',
      actual: pick(verdict, 'rule_broken'),
      expected: [
        {
          kind: 'rule_broken',
          event: 'ev',
          key: 'pairing.rematch',
          fixture: { kind: 'new', ordinal: 2 },
          cost: [1],
        },
      ],
    });
  });

  test('a wrong cost total', () => {
    const d = drawnOf(third.answer)[0]!;
    const total = d.assessment.totals.find(
      (t) => t.key === 'judging.load_balance',
    )!;
    const verdict = check(
      third.input,
      withDraw(third.answer, (x) => ({
        ...x,
        assessment: {
          ...x.assessment,
          totals: x.assessment.totals.map((t) =>
            t.key === 'judging.load_balance'
              ? { ...t, cost: [t.cost[0]! + 1] }
              : t,
          ),
        },
      })),
    );
    assert({
      given:
        'a draw whose load-balance total is one more than its fixtures add up to',
      should: 'name the key with the recounted and reported totals',
      actual: pick(verdict, 'cost_total'),
      expected: [
        {
          kind: 'cost_total',
          event: 'ev',
          key: 'judging.load_balance',
          expected: total.cost,
          actual: [total.cost[0]! + 1],
        },
      ],
    });
  });

  test('a wrong per-fixture term', () => {
    const verdict = check(
      third.input,
      withDraw(third.answer, (x) => ({
        ...x,
        assessment: {
          ...x.assessment,
          fixtures: x.assessment.fixtures.map((f, i) =>
            i === 0
              ? {
                  ...f,
                  terms: f.terms.map((t) =>
                    t.key === 'pairing.rematch' ? { ...t, cost: [3] } : t,
                  ),
                }
              : f,
          ),
        },
      })),
    );
    assert({
      given:
        'a draw whose first fixture reports a rematch cost of 3 it does not have',
      should: 'name the term, and the total it no longer adds up to',
      actual: [
        pick(verdict, 'cost_term').map((v) => [v.key, v.expected, v.actual]),
        pick(verdict, 'cost_total').length,
      ],
      expected: [[['pairing.rematch', [0], [3]]], 0],
    });
  });

  test('an inputs record missing a result', () => {
    const d = drawnOf(third.answer)[0]!;
    const [dropped, ...kept] = d.inputs.results;
    const verdict = check(
      third.input,
      withDraw(third.answer, (x) => ({
        ...x,
        inputs: { ...x.inputs, results: kept },
      })),
    );
    assert({
      given: 'a draw whose inputs record leaves out a counted result',
      should: 'name the missing result',
      actual: pick(verdict, 'inputs_results'),
      expected: [
        { kind: 'inputs_results', event: 'ev', missing: [dropped!], extra: [] },
      ],
    });
  });

  test('an inputs record naming a superseded result', () => {
    const corrected = playEvent({
      label: 'corrections',
      seed: 7,
      format: twoSides,
      entries: Array.from({ length: 8 }, (_, i) => entry(`e${i}`, null)),
      settings: swissPower,
      judges: null,
      rounds: 3,
    }).find(
      ({ input }) =>
        input.call === 'windowed' &&
        input.event.history.results.some((r) => r.supersedes !== null),
    )!;
    const superseded = (
      corrected.input.call === 'windowed'
        ? corrected.input.event.history.results
        : []
    ).find((r) => r.supersedes !== null)!.supersedes!;
    const verdict = check(
      corrected.input,
      withDraw(corrected.answer, (x) => ({
        ...x,
        inputs: {
          ...x.inputs,
          results: x.inputs.results.map((id) =>
            id === `${superseded}-fix` ? superseded : id,
          ),
        },
      })),
    );
    assert({
      given:
        'a record naming a result that a correction supersedes, in place of the correction',
      should: 'name the correction missing and the superseded result extra',
      actual: pick(verdict, 'inputs_results'),
      expected: [
        {
          kind: 'inputs_results',
          event: 'ev',
          missing: [`${superseded}-fix`],
          extra: [superseded],
        },
      ],
    });
  });

  test('a draw a better plan beats', () => {
    const input: DrawInput = windowed(
      request({
        event: 'ev',
        entries: ['a', 'b', 'c', 'd'].map((id) => entry(id, null)),
        settings: swissPower,
        tabRound: 2,
        cutoff: 1,
        history: {
          fixtures: existingCase.history.fixtures.slice(0, 2),
          results: existingCase.history.results.slice(0, 2),
        },
      }),
      null,
    );
    const answer = draw(input);
    const worse = withDraw(
      answer,
      (d) =>
        ({
          ...d,
          add: [
            {
              ordinal: 1,
              fixture: { kind: 'pairing', sides: ['a', 'd'], panel: [] },
            },
            {
              ordinal: 2,
              fixture: { kind: 'pairing', sides: ['c', 'b'], panel: [] },
            },
          ],
        }) as Draw,
    );
    assert({
      given:
        'winners a and c each paired down against a loser instead of against each other',
      should:
        'accept the engine draw and find a better plan than the corrupted one',
      actual: [
        check(input, answer).ok,
        pick(check(input, worse), 'not_optimal').length,
      ],
      expected: [true, 1],
    });
  });
});

describe('check: infeasible answers', () => {
  const metOnce = windowed(
    request({
      event: 'ev',
      entries: [entry('a', null), entry('b', null)],
      settings: swissPower,
      tabRound: 2,
      cutoff: 1,
      history: {
        fixtures: existingCase.history.fixtures.slice(0, 1),
        results: existingCase.history.results.slice(0, 1),
      },
    }),
    null,
  );

  test('a field that can only rematch', () => {
    const answer = draw(metOnce);
    assert({
      given: 'two entries who met in round one, under a rematch rule',
      should:
        'be declared infeasible by the rematch rule, and the checker agree',
      actual: { kind: answer.kind, verdict: check(metOnce, answer) },
      expected: { kind: 'infeasible', verdict: { ok: true, violations: [] } },
    });
  });

  test('a claim of infeasibility on a feasible field', () => {
    const verdict = check(existingCase.input, {
      kind: 'infeasible',
      cause: 'rules',
      event: 'ev',
      rules: ['pairing.rematch'],
      relaxations: [],
    });
    assert({
      given:
        'a six-entry field that can be drawn without a rematch, claimed infeasible by the rematch rule',
      should: 'reject the claim',
      actual: verdict.violations,
      expected: [
        {
          kind: 'infeasible_rules_feasible',
          event: 'ev',
          rules: ['pairing.rematch'],
        },
      ],
    });
  });

  test('a set of rules that is not minimal', () => {
    const verdict = check(metOnce, {
      kind: 'infeasible',
      cause: 'rules',
      event: 'ev',
      rules: ['pairing.rematch', 'bye.repeat'],
      relaxations: [],
    });
    assert({
      given: 'a rematch-only infeasibility claimed with the bye rule as well',
      should: 'name the rule whose dropping does not help',
      actual: verdict.violations,
      expected: [
        {
          kind: 'infeasible_rules_not_minimal',
          event: 'ev',
          key: 'bye.repeat',
        },
      ],
    });
  });

  test('slot collisions', () => {
    const shared = slotCase({ share: true });
    const answer = draw(shared);
    const unfounded = check(slotCase(), {
      kind: 'infeasible',
      cause: 'slot',
      collisions: [
        {
          person: 'd1-p',
          holders: [{ kind: 'entry', event: 'debate', entry: 'd1' }],
        },
      ],
    });
    assert({
      given:
        'an engine slot collision, and a claimed one for a person held once',
      should: 'accept the first and reject the second',
      actual: [answer.kind, check(shared, answer).ok, unfounded.violations],
      expected: [
        'infeasible',
        true,
        [{ kind: 'infeasible_slot_unfounded', person: 'd1-p' }],
      ],
    });
  });
});
