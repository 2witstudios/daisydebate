import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { draw } from '../draw';
import {
  drawsOf,
  entries,
  judges,
  playTwoSided,
  request,
  seedOf,
  twoSides,
} from '../draw/draw.test-support';
import type { StageHistory, TwoSides } from '../shapes/competition';
import type { DrawInput, Plan } from '../shapes/draw';
import { assess, whyNot } from './index';

setupRitewayBun();

const field = entries(10, 5);
const round = (
  tabRound: number,
  history: StageHistory<TwoSides>,
): DrawInput => ({
  call: 'slot',
  slot: 'slot',
  events: [
    request(twoSides, {
      entries: field,
      tabRound,
      history,
      cutoff: tabRound - 1,
    }),
  ],
  judges: judges(6),
  commitments: [],
  seed: seedOf(tabRound),
});
const first = drawsOf(draw(round(1, { fixtures: [], results: [] })))[0]!;
const history = playTwoSided({ fixtures: [], results: [] }, first, 1);
const input = round(2, history);
const drawn = drawsOf(draw(input))[0]!;
const asPlan = (d: typeof drawn): Plan =>
  ({ event: d.event, keep: d.keep, add: d.add, withdraw: d.withdraw }) as Plan;

describe('assess', () => {
  test('a plan made by the engine and the same plan handed back by a person are costed identically', () => {
    const [again] = assess(input, [
      JSON.parse(JSON.stringify(asPlan(drawn))) as Plan,
    ]);
    assert({
      given: 'the engine draw of round 2, handed back as plain data',
      should: 'give the same assessment, fixture by fixture',
      actual: JSON.stringify(again),
      expected: JSON.stringify(drawn.assessment),
    });
  });

  test('a plan that breaks a rule is reported with the rule and the fixture, and comes back as given', () => {
    const met = first.add.find((a) => a.fixture.kind === 'pairing')!
      .fixture as { sides: readonly [string, string] };
    const [x, y] = met.sides;
    const plan = asPlan(drawn) as Plan & {
      add: {
        ordinal: number;
        fixture: {
          kind: string;
          sides?: readonly string[];
          panel?: readonly string[];
        };
      }[];
    };
    const others = plan.add.filter(
      (a) =>
        a.fixture.kind === 'pairing' &&
        !a.fixture.sides!.includes(x) &&
        !a.fixture.sides!.includes(y),
    );
    const partners = plan.add
      .filter(
        (a) =>
          a.fixture.kind === 'pairing' &&
          (a.fixture.sides!.includes(x) || a.fixture.sides!.includes(y)),
      )
      .flatMap((a) => a.fixture.sides!.filter((e) => e !== x && e !== y));
    const byes = plan.add.filter((a) => a.fixture.kind === 'bye');
    const changed = {
      ...plan,
      add: [
        { ordinal: 1, fixture: { kind: 'pairing', sides: [x, y], panel: [] } },
        {
          ordinal: 2,
          fixture: { kind: 'pairing', sides: partners, panel: [] },
        },
        ...[...others, ...byes].map((a, i) => ({ ...a, ordinal: i + 3 })),
      ],
    } as unknown as Plan;
    const before = JSON.stringify(changed);
    const [result] = assess(input, [changed]);
    assert({
      given: 'a person re-pairing two entries who met in round 1',
      should:
        'report the rematch rule on that fixture, and leave the plan as given',
      actual: [
        result!.broken.filter((b) => b.key === 'pairing.rematch'),
        JSON.stringify(changed) === before,
      ],
      expected: [
        [
          {
            event: 'ev',
            key: 'pairing.rematch',
            fixture: { kind: 'new', ordinal: 1 },
          },
        ],
        true,
      ],
    });
  });

  test('each fixture carries its best single exchange', () => {
    assert({
      given: 'the engine draw of round 2',
      should: 'name an exchange for every pairing',
      actual: drawn.assessment.fixtures.every(
        (f) =>
          f.exchange !== null ||
          drawn.add.find(
            (a) => a.ordinal === (f.fixture as { ordinal: number }).ordinal,
          )?.fixture.kind === 'bye',
      ),
      expected: true,
    });
  });
});

describe('whyNot', () => {
  test('a pinned alternative gives the difference field by field and every fixture that would change', () => {
    const top = drawn.add.find((a) => a.fixture.kind === 'pairing')!
      .fixture as { sides: readonly [string, string] };
    const other = drawn.add.filter((a) => a.fixture.kind === 'pairing')[1]!
      .fixture as { sides: readonly [string, string] };
    const answer = whyNot(input, 'ev', [top.sides[0], other.sides[0]]);
    assert({
      given:
        'why not the first side of the top fixture against the first side of the second',
      should:
        'answer with a difference in at least one field and both fixtures changed',
      actual:
        answer.kind === 'answered'
          ? [
              answer.difference.length > 0,
              answer.changed.filter((r) => r.kind === 'new' && r.ordinal <= 2)
                .length,
            ]
          : answer.kind,
      expected: [true, 2],
    });
  });
});
