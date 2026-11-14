import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { Id } from '../shapes/competition';
import type { DrawInput, Plan, RuleBreak } from '../shapes/draw';
import { randomPreset, swissPower } from '../simulate/presets';
import { entry, request, windowed } from './build.test-support';
import { checkPlans } from './index';

setupRitewayBun();

/** Six entries who met as a–b, c–d, e–f in round one; a and c share a school. */
const roundTwo = (settings = swissPower): DrawInput => {
  const pairs: readonly (readonly [Id, Id])[] = [
    ['a', 'b'],
    ['c', 'd'],
    ['e', 'f'],
  ];
  return windowed(
    request({
      event: 'ev',
      entries: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) =>
        entry(id, id === 'a' || id === 'c' ? 'shared' : null),
      ),
      settings,
      tabRound: 2,
      cutoff: 1,
      history: {
        fixtures: pairs.map(([x, y], i) => ({
          id: `h${i}`,
          tabRound: 1,
          fixture: { kind: 'pairing', sides: [x, y], panel: [] },
        })),
        results: pairs.map(([x], i) => ({
          id: `r${i}`,
          fixture: `h${i}`,
          kind: 'decided',
          supersedes: null,
          certified: true,
          outcome: { kind: 'winner', winner: x, ballots: [] },
        })),
      },
    }),
    null,
  );
};

const plan = (...pairs: readonly (readonly [Id, Id])[]): Plan => ({
  event: 'ev',
  keep: [],
  add: pairs.map(([x, y], i) => ({
    ordinal: i + 1,
    fixture: { kind: 'pairing', sides: [x, y], panel: [] },
  })),
  withdraw: [],
});

const rematch: RuleBreak = {
  event: 'ev',
  key: 'pairing.rematch',
  fixture: { kind: 'new', ordinal: 1 },
};

/** A person's change: a–b meet again in fixture 1, and nothing else breaks a rule. */
const changed = plan(['a', 'b'], ['d', 'e'], ['f', 'c']);

describe('checkPlans: overrides (TAB-7.23)', () => {
  test('the overridden rule break is accepted', () => {
    assert({
      given: 'a changed plan with one rematch, and that rematch overridden',
      should: 'accept the plan',
      actual: checkPlans(roundTwo(), [changed], [rematch]),
      expected: { ok: true, violations: [] },
    });
  });

  test('without the override the break is a violation', () => {
    assert({
      given: 'the same plan with nothing overridden',
      should: 'name the rematch at fixture 1',
      actual: checkPlans(roundTwo(), [changed], []).violations,
      expected: [
        {
          kind: 'rule_broken',
          event: 'ev',
          key: 'pairing.rematch',
          fixture: { kind: 'new', ordinal: 1 },
          cost: [1],
        },
      ],
    });
  });

  test('an override of another fixture does not cover it', () => {
    const elsewhere: RuleBreak = {
      ...rematch,
      fixture: { kind: 'new', ordinal: 2 },
    };
    assert({
      given: 'the rematch overridden at fixture 2 instead of fixture 1',
      should: 'still name the break at fixture 1',
      actual: checkPlans(roundTwo(), [changed], [elsewhere]).violations.map(
        (v) => v.kind,
      ),
      expected: ['rule_broken'],
    });
  });

  test('any other rule break is still rejected', () => {
    const settings = {
      ...swissPower,
      'pairing.same_school': { force: 'rule' },
    } as const;
    const rematchOnly = plan(['a', 'b'], ['c', 'e'], ['d', 'f']);
    const schoolmates = plan(['a', 'c'], ['b', 'e'], ['d', 'f']);
    assert({
      given:
        'a same-school rule beside the rematch rule, and only the rematch overridden',
      should: 'accept the rematch alone and reject the schoolmates paired',
      actual: [
        checkPlans(roundTwo(settings), [rematchOnly], [rematch]).ok,
        checkPlans(roundTwo(settings), [schoolmates], [rematch]).violations,
      ],
      expected: [
        true,
        [
          {
            kind: 'rule_broken',
            event: 'ev',
            key: 'pairing.same_school',
            fixture: { kind: 'new', ordinal: 1 },
            cost: [1],
          },
        ],
      ],
    });
  });

  test('a broken structural fact is rejected whatever is overridden', () => {
    const everything: RuleBreak[] = (
      [
        'pairing.rematch',
        'pairing.same_school',
        'pairing.side_balance',
        'bye.repeat',
      ] as const
    ).flatMap((key) =>
      [1, 2, 3].map(
        (ordinal) =>
          ({
            event: 'ev',
            key,
            fixture: { kind: 'new', ordinal },
          }) as RuleBreak,
      ),
    );
    const twice = plan(['a', 'b'], ['a', 'e'], ['f', 'c']);
    assert({
      given:
        'a plan placing a twice and leaving d out, with every rule of every fixture overridden',
      should: 'name both placement facts',
      actual: checkPlans(roundTwo(), [twice], everything).violations,
      expected: [
        {
          kind: 'entry_placed_twice',
          event: 'ev',
          entry: 'a',
          fixture: { kind: 'new', ordinal: 2 },
        },
        { kind: 'entry_not_placed', event: 'ev', entry: 'd' },
      ],
    });
  });

  test('a prematched stage never pairs a met pair again, whatever is overridden', () => {
    const prematched = {
      ...randomPreset,
      'pairing.rematch': { force: 'off' },
    } as const;
    assert({
      given:
        'a prematched stage with the rematch setting off, a plan pairing a–b again, and the rematch overridden',
      should: 'name the repeated pair as a structural fact',
      actual: checkPlans(roundTwo(prematched), [changed], [rematch]).violations,
      expected: [
        {
          kind: 'prematched_repeat',
          event: 'ev',
          fixture: { kind: 'new', ordinal: 1 },
          entries: ['a', 'b'],
        },
      ],
    });
  });
});
