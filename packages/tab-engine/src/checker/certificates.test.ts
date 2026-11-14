import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { draw } from '../draw';
import type { Entry, Fixture, Id } from '../shapes/competition';
import type { Draw, DrawAnswer, DrawInput, EventRequest } from '../shapes/draw';
import type { ResolvedSettings } from '../shapes/settings';
import {
  randomPreset,
  roundRobinPreset,
  swissPower,
} from '../simulate/presets';
import {
  drawnOf,
  entry,
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

type Rules = Extract<DrawAnswer, { readonly cause: 'rules' }>;
type Unresolved = Extract<DrawAnswer, { readonly kind: 'unresolved' }>;

const rulesOf = (answer: DrawAnswer): Rules => {
  if (answer.kind !== 'infeasible' || answer.cause !== 'rules')
    throw new Error(`expected infeasible by rules, got ${answer.kind}`);
  return answer;
};

const rejected = (played: readonly Played[], label: string) =>
  played.flatMap(({ input, answer }, round) => {
    const verdict = check(input, answer);
    return verdict.ok
      ? []
      : [{ label, round: round + 1, violations: verdict.violations }];
  });

const ids = (n: number) => Array.from({ length: n }, (_, i) => `e${i}`);

/** Every pair of the four met once, over three rounds. */
const allMet = (people: readonly Id[]) => {
  const fixtures = [];
  let k = 0;
  for (let i = 0; i < people.length; i += 1)
    for (let j = i + 1; j < people.length; j += 1) {
      fixtures.push({
        id: `m${k}`,
        tabRound: 1 + (k % 3),
        fixture: {
          kind: 'pairing' as const,
          sides: [people[i]!, people[j]!] as [Id, Id],
          panel: [],
        },
      });
      k += 1;
    }
  return { fixtures, results: [] };
};

const metOnce = windowed(
  request({
    event: 'ev',
    entries: [entry('a', null), entry('b', null)],
    settings: swissPower,
    tabRound: 2,
    cutoff: 1,
    history: allMet(['a', 'b']),
  }),
  null,
);

describe('check: the round-robin circle (round 2, item 1)', () => {
  const withdrawnOne = (seed: number): readonly Entry[] =>
    ids(6 + (seed % 3)).map((id, i) => ({
      ...entry(id, null),
      status: i === seed % 4 ? 'withdrawn' : 'active',
    }));

  test('engine round robins are accepted, drops included', () => {
    const found = [];
    for (let seed = 0; seed < 8; seed += 1)
      found.push(
        ...rejected(
          playEvent({
            label: 'circle',
            seed,
            format: twoSides,
            entries:
              seed % 2 === 0
                ? ids(5 + seed).map((id) => entry(id, null))
                : withdrawnOne(seed),
            settings: roundRobinPreset,
            judges: null,
            rounds: 5,
          }),
          `seed ${seed}`,
        ),
      );
    assert({
      given:
        'eight round robins of 5 to 12 entries, some with a withdrawn entry',
      should: 'accept every engine round as its circle',
      actual: found,
      expected: [],
    });
  });

  test('a round off the circle', () => {
    const { input, answer } = playEvent({
      label: 'circle-corrupt',
      seed: 1,
      format: twoSides,
      entries: ids(6).map((id) => entry(id, null)),
      settings: roundRobinPreset,
      judges: null,
      rounds: 2,
    })[1]!;
    const d = drawnOf(answer)[0]!;
    const [p, q] = d.add.map((a) => a.fixture as Fixture);
    if (p?.kind !== 'pairing' || q?.kind !== 'pairing')
      throw new Error('expected pairings');
    const swapped: DrawAnswer = {
      kind: 'drawn',
      draws: [
        {
          ...d,
          add: d.add.map((a, i) =>
            i === 0
              ? { ...a, fixture: { ...p, sides: [p.sides[0], q.sides[1]] } }
              : i === 1
                ? { ...a, fixture: { ...q, sides: [q.sides[0], p.sides[1]] } }
                : a,
          ),
        } as Draw,
      ],
    };
    assert({
      given: 'a second round-robin round with two opponents swapped',
      should: 'name the scheduled pairings missing and the drawn ones extra',
      actual: pick(check(input, swapped), 'schedule_mismatch').map((v) => [
        v.missing.length,
        v.extra.length,
      ]),
      expected: [[2, 2]],
    });
  });

  /** Round two of five, every one of whom had a bye in round one. */
  const everyoneByed = windowed(
    request({
      event: 'ev',
      entries: ids(5).map((id) => entry(id, null)),
      settings: roundRobinPreset,
      tabRound: 2,
      cutoff: 1,
      history: {
        fixtures: ids(5).map((e, i) => ({
          id: `h${i}`,
          tabRound: 1,
          fixture: { kind: 'bye', entry: e },
        })),
        results: [],
      },
    }),
    null,
  );

  test('a schedule that breaks the bye rule', () => {
    const answer = rulesOf(draw(everyoneByed));
    const clean = windowed(
      request({
        event: 'ev',
        entries: ids(5).map((id) => entry(id, null)),
        settings: roundRobinPreset,
        tabRound: 2,
      }),
      null,
    );
    assert({
      given:
        'a round-robin round whose scheduled bye repeats, and the same claim where no one has had a bye',
      should: 'confirm the first by the circle and refuse the second',
      actual: [
        answer.certificate,
        check(everyoneByed, answer).ok,
        pick(check(clean, answer), 'infeasible_certificate_invalid').map(
          (v) => v.reason,
        ),
      ],
      expected: [{ kind: 'schedule' }, true, ['the schedule keeps bye.repeat']],
    });
  });
});

describe('check: infeasible by rules is confirmed (round 2, item 2)', () => {
  test('a barrier the engine finds is confirmed; a broken one is not', () => {
    const answer = rulesOf(draw(metOnce));
    const stray = check(metOnce, {
      ...answer,
      certificate: { kind: 'barrier', removed: ['zz'] },
    });
    const tooMany = check(metOnce, {
      ...answer,
      certificate: { kind: 'barrier', removed: ['a', 'b'] },
    });
    assert({
      given:
        'two entries who met, under a rematch rule; then a barrier naming a stranger, then one removing both',
      should: 'accept the engine certificate and refuse both others',
      actual: [
        answer.certificate,
        check(metOnce, answer).ok,
        pick(stray, 'infeasible_certificate_invalid').map((v) => v.reason),
        pick(tooMany, 'infeasible_certificate_invalid').map((v) => v.reason),
      ],
      expected: [
        { kind: 'barrier', removed: [] },
        true,
        ['removed zz is no vertex'],
        ['0 odd components left by removing 2'],
      ],
    });
  });

  test('every engine infeasible answer over seeded fields is confirmed', () => {
    const found: unknown[] = [];
    const certificates = new Set<string>();
    for (let seed = 0; seed < 200; seed += 1) {
      const next = numbers('sweep', seed);
      const size = 2 + next(7);
      const entries = ids(size).map((id, i) =>
        entry(id, next(2) === 0 ? 'x' : `s${i}`),
      );
      // Each earlier round a partial matching: shuffled, paired off, some pairs kept, the odd one out byed.
      const fixtures = [];
      let n = 0;
      for (let round = 1; round <= 2; round += 1) {
        const order = ids(size);
        for (let k = order.length - 1; k >= 1; k -= 1) {
          const m = next(k + 1);
          [order[k], order[m]] = [order[m]!, order[k]!];
        }
        for (let k = 0; k + 1 < order.length; k += 2)
          if (next(3) !== 0) {
            fixtures.push({
              id: `f${n}`,
              tabRound: round,
              fixture: {
                kind: 'pairing' as const,
                sides: [order[k]!, order[k + 1]!] as [Id, Id],
                panel: [],
              },
            });
            n += 1;
          }
        if (order.length % 2 === 1 && next(2) === 0) {
          fixtures.push({
            id: `f${n}`,
            tabRound: round,
            fixture: { kind: 'bye' as const, entry: order[order.length - 1]! },
          });
          n += 1;
        }
      }
      const settings: ResolvedSettings = {
        ...(seed % 2 === 1 ? swissPower : randomPreset),
        'pairing.same_school': {
          force: next(2) === 0 ? 'rule' : 'preference',
        },
      };
      const input = windowed(
        request({
          event: 'ev',
          entries,
          settings,
          tabRound: 3,
          cutoff: 2,
          history: { fixtures, results: [] },
        }),
        null,
      );
      const answer = draw(input);
      if (answer.kind === 'infeasible' && answer.cause === 'rules')
        certificates.add(
          `${answer.certificate.kind}${answer.certificate.kind === 'barrier' && answer.certificate.removed.length > 0 ? '+' : ''}`,
        );
      const verdict = check(input, answer);
      if (!verdict.ok) found.push({ seed, violations: verdict.violations });
    }
    assert({
      given:
        '200 seeded two-sided fields with random meetings, byes and school rules',
      should:
        'confirm every engine answer, barriers with removed vertices among them',
      actual: { found, barrierWithRemoved: certificates.has('barrier+') },
      expected: { found: [], barrierWithRemoved: true },
    });
  });

  test('a school with more entries than sections', () => {
    const input = windowed(
      request({
        event: 'ev',
        format: speakers,
        entries: ids(12).map((id, i) => entry(id, i < 3 ? 'big' : `s${i}`)),
        settings: { ...swissPower, 'pairing.same_school': { force: 'rule' } },
      }),
      null,
    );
    const answer = rulesOf(draw(input));
    const miscounted = check(input, {
      ...answer,
      certificate: {
        kind: 'school_count',
        school: 'big',
        entries: 2,
        sections: 1,
      },
    });
    assert({
      given:
        'twelve speakers in two sections, three of one school, under a school rule',
      should: 'confirm the count, and refuse a miscounted one',
      actual: [
        answer.certificate,
        check(input, answer).ok,
        pick(miscounted, 'infeasible_certificate_invalid').map((v) => v.reason),
      ],
      expected: [
        { kind: 'school_count', school: 'big', entries: 3, sections: 2 },
        true,
        ['the school has 3 entries, not 2', 'there are 2 sections, not 1'],
      ],
    });
  });

  test('a judging rule named', () => {
    const answer = rulesOf(draw(metOnce));
    assert({
      given: 'an infeasibility claimed by the conflict rule',
      should: 'refuse it: judge shortages are panel answers',
      actual: check(metOnce, { ...answer, rules: ['judging.conflict'] })
        .violations,
      expected: [
        {
          kind: 'infeasible_rules_key',
          event: 'ev',
          key: 'judging.conflict',
          reason: 'judging',
        },
      ],
    });
  });

  test('witnesses', () => {
    const answer = rulesOf(draw(metOnce));
    const missing = check(metOnce, { ...answer, witnesses: [] });
    const unsound = check(metOnce, {
      ...answer,
      witnesses: [
        {
          key: 'pairing.rematch',
          plan: { event: 'ev', keep: [], add: [], withdraw: [] },
        },
      ],
    });
    assert({
      given:
        'the rematch claim with no witness, and with a witness placing nobody',
      should: 'name the witness missing, and the unsound one',
      actual: [
        pick(missing, 'infeasible_witness_missing'),
        pick(unsound, 'infeasible_witness_invalid').map((v) =>
          v.found.map((f) => f.kind),
        ),
      ],
      expected: [
        [
          {
            kind: 'infeasible_witness_missing',
            event: 'ev',
            key: 'pairing.rematch',
          },
        ],
        [['entry_not_placed', 'entry_not_placed']],
      ],
    });
  });
});

describe('check: no plan and unresolved (round 2, items 3 and 4)', () => {
  const bracket = playBracket({
    label: 'no-plan',
    seed: 0,
    format: twoSides,
    entries: ids(5).map((id) => entry(id, null)),
    settings: swissPower,
    judges: null,
    rounds: 6,
  });

  test('a decided bracket', () => {
    const last = bracket[bracket.length - 1]!;
    const noPlan: DrawAnswer = {
      kind: 'infeasible',
      cause: 'structure',
      event: 'ev',
      fact: 'no_plan',
    };
    assert({
      given:
        'a five-seed bracket played to its final, then the claim of no plan on its second round',
      should:
        'confirm the engine’s no plan after the final and refuse the other',
      actual: [
        last.answer,
        check(last.input, last.answer).ok,
        check(bracket[1]!.input, noPlan).violations,
      ],
      expected: [
        noPlan,
        true,
        [{ kind: 'infeasible_no_plan_unfounded', event: 'ev' }],
      ],
    });
  });

  test('a prematched field with no unmet pair left', () => {
    const settings: ResolvedSettings = {
      ...randomPreset,
      'pairing.rematch': { force: 'off' },
    };
    const exhausted = windowed(
      request({
        event: 'ev',
        entries: ids(4).map((id) => entry(id, null)),
        settings,
        tabRound: 4,
        cutoff: 3,
        history: allMet(ids(4)),
      }),
      null,
    );
    const open = windowed(
      request({
        event: 'ev',
        entries: ids(4).map((id) => entry(id, null)),
        settings,
        tabRound: 2,
      }),
      null,
    );
    const answer = draw(exhausted);
    assert({
      given:
        'four prematched entries who have all met, and four who have not met',
      should: 'confirm no plan for the first, and refuse it for the second',
      actual: [
        answer.kind,
        check(exhausted, answer).ok,
        check(open, answer).violations,
      ],
      expected: [
        'infeasible',
        true,
        [{ kind: 'infeasible_no_plan_unfounded', event: 'ev' }],
      ],
    });
  });

  test('an unresolved answer breaking nothing', () => {
    const played = playEvent({
      label: 'four',
      seed: 0,
      format: { outcome: 'ranking', of: 'sides', sides: 4 },
      entries: (() => {
        const next = numbers('field', 0);
        return ids(8).map((id) =>
          entry(id, next(3) === 0 ? null : `s${next(3)}`),
        );
      })(),
      settings: swissPower,
      judges: Array.from({ length: 3 }, (_, i) => ({
        id: `j${i}`,
        person: `j${i}-person`,
        protection: [],
        events: null,
        conflicts: [],
        strikes: [],
        judged: [],
        tabRoundsJudged: 0,
        outstandingBallots: 0,
        chair: true,
        available: true,
      })),
      rounds: 2,
    })[1]!;
    const answer = played.answer as Unresolved;
    assert({
      given: 'an engine unresolved answer with its broken list emptied',
      should: 'name it unbroken',
      actual: [
        answer.kind,
        pick(
          check(played.input, { ...answer, broken: [] }),
          'unresolved_unbroken',
        ),
      ],
      expected: ['unresolved', [{ kind: 'unresolved_unbroken', event: 'ev' }]],
    });
  });
});

describe('check: seated judges in a slot', () => {
  const withExisting = (hold: 'fixed' | 'movable'): DrawInput => {
    const base = slotCase();
    if (base.call !== 'slot') throw new Error('expected a slot');
    return {
      ...base,
      events: base.events.map((e) =>
        e.event === 'debate'
          ? ({
              ...e,
              existing: [
                {
                  id: 'x1',
                  hold,
                  fixture: {
                    kind: 'pairing',
                    sides: ['d0', 'd1'],
                    panel: ['j4'],
                  },
                },
              ],
            } as EventRequest)
          : e,
      ),
    };
  };

  test('a fixed fixture’s judge, also committed elsewhere', () => {
    const input = withExisting('fixed');
    const answer = draw(input);
    assert({
      given: 'a fixed pairing seating j4, whom a commitment also holds',
      should:
        'be a slot collision the checker confirms, the fixed fixture a holder',
      actual: [
        answer.kind === 'infeasible' && answer.cause === 'slot'
          ? answer.collisions.map((c) => c.person)
          : answer.kind,
        check(input, answer).ok,
      ],
      expected: [['j4-person'], true],
    });
  });

  test('a movable fixture’s judge, now committed elsewhere', () => {
    const input = withExisting('movable');
    const answer = draw(input);
    assert({
      given: 'a movable pairing seating j4, whom a commitment also holds',
      should:
        'be withdrawn, and the checker not count keeping it as a better plan',
      actual: [drawnOf(answer)[0]!.withdraw, check(input, answer).ok],
      expected: [['x1'], true],
    });
  });
});
