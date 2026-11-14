import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type {
  Commitment,
  DrawInput,
  EventRequest,
  SlotJudge,
} from '../shapes/draw';
import { draw } from './index';
import { entriesOf, panelOf } from './facts';
import {
  drawsOf,
  entries,
  entry,
  fixturesOf,
  fourSides,
  judge,
  judges,
  request,
  seedOf,
  speakers,
  twoSides,
  withSettings,
} from './draw.test-support';

setupRitewayBun();

const fourTeam = withSettings({
  'pairing.rematch': { force: 'off' },
  'pairing.same_school': { force: 'off' },
});

const slotCall = (
  events: readonly EventRequest[],
  pool: readonly SlotJudge[] | null,
  commitments: readonly Commitment[] = [],
): DrawInput => ({
  call: 'slot',
  slot: 'slot-1',
  events,
  judges: pool,
  commitments,
  seed: seedOf(6),
});

describe('one draw for three formats', () => {
  test('pairings for two and four sides, sections for speakers, byes for the rest, no method from the caller', () => {
    const answer = draw(
      slotCall(
        [
          request(twoSides, { event: 'debate', entries: entries(7, 7, 'd') }),
          request(fourSides, {
            event: 'parli',
            entries: entries(9, 9, 'p'),
            settings: fourTeam,
          }),
          request(speakers, { event: 'speech', entries: entries(13, 13, 's') }),
        ],
        null,
      ),
    );
    const kinds = drawsOf(answer).map((d) => [
      d.event,
      [...new Set(fixturesOf(d).map((f) => f.kind))].sort(),
    ]);
    assert({
      given:
        'a slot with a two-side, a four-side and a speaker event and no method named',
      should: 'answer pairings and a bye, pairings and a bye, and sections',
      actual: kinds,
      expected: [
        ['debate', ['bye', 'pairing']],
        ['parli', ['bye', 'pairing']],
        ['speech', ['section']],
      ],
    });
  });
});

describe('judges across a slot', () => {
  const debate = request(twoSides, { event: 'a', entries: entries(8, 4, 'a') });
  const speech = request(speakers, {
    event: 'b',
    entries: entries(12, 6, 'b'),
  });

  test('panels break no conflict, strike, availability or unsubmitted-ballot rule', () => {
    const rules = withSettings({
      'judging.unsubmitted_ballot': { force: 'rule' },
    });
    const pool = judges(16).map((j, i) =>
      i % 4 === 0
        ? { ...j, available: false }
        : i % 4 === 1
          ? { ...j, outstandingBallots: 1 }
          : i % 4 === 2
            ? {
                ...j,
                conflicts: ['a00', 'a01', 'b00'],
                strikes: ['a02', 'b01'],
              }
            : j,
    );
    const [first, second] = drawsOf(
      draw(
        slotCall(
          [
            { ...debate, settings: rules },
            { ...speech, settings: rules },
          ],
          pool,
        ),
      ),
    );
    const byId = new Map(pool.map((j) => [j.id, j]));
    const broken = [...fixturesOf(first!), ...fixturesOf(second!)].flatMap(
      (f) =>
        panelOf(f).flatMap((id) => {
          const j = byId.get(id)!;
          const seated = entriesOf(f);
          return [
            ...(j.available ? [] : ['availability']),
            ...(j.outstandingBallots > 0 ? ['unsubmitted'] : []),
            ...(seated.some((e) => j.conflicts.includes(e))
              ? ['conflict']
              : []),
            ...(seated.some((e) => j.strikes.includes(e)) ? ['strike'] : []),
          ];
        }),
    );
    assert({
      given:
        'two events sharing sixteen judges, some unavailable, owing ballots, conflicted or struck',
      should: 'seat every panel without breaking one of those rules',
      actual: [
        broken,
        [...fixturesOf(first!), ...fixturesOf(second!)].every(
          (f) => f.kind === 'bye' || panelOf(f).length === 1,
        ),
      ],
      expected: [[], true],
    });
  });

  test('a slot that cannot be staffed names the fixtures left short and what each rule removed', () => {
    const pool = [
      judge('j0'),
      judge('j1', { available: false }),
      judge('j2', { available: false }),
      judge('j3', {
        conflicts: ['a00', 'a01', 'a02', 'a03', 'a04', 'a05', 'a06', 'a07'],
      }),
    ];
    const answer = draw(slotCall([debate], pool));
    assert({
      given:
        'four fixtures and four judges, two unavailable and one conflicted with every entry',
      should:
        'answer infeasible panels: three fixtures short, two held by availability and one by conflict',
      actual:
        answer.kind === 'infeasible' && answer.cause === 'panels'
          ? [
              answer.short.reduce((s, f) => s + f.missing, 0),
              answer.removed,
              answer.draws.length,
            ]
          : answer.kind,
      expected: [
        3,
        [
          { key: 'judging.availability', judges: 2 },
          { key: 'judging.conflict', judges: 1 },
        ],
        1,
      ],
    });
  });
});

describe('commitments in the slot', () => {
  test('no judge and no entry member ends up in two fixtures, and no committed fixture is touched', () => {
    const pool = judges(6);
    const commitments = [
      {
        event: 'other',
        fixture: 'c1',
        people: ['person-j00', 'person-j01', 'person-x'],
      },
    ];
    const d = drawsOf(
      draw(
        slotCall(
          [request(twoSides, { entries: entries(8) })],
          pool,
          commitments,
        ),
      ),
    )[0]!;
    const seated = fixturesOf(d).flatMap((f) => panelOf(f));
    assert({
      given: 'a slot where another event has committed two of six judges',
      should: 'seat neither committed judge',
      actual: [seated.includes('j00'), seated.includes('j01'), seated.length],
      expected: [false, false, 4],
    });
  });

  test('an entry member already committed makes the call infeasible and names the person', () => {
    const commitments = [
      { event: 'other', fixture: 'c1', people: ['person-e03'] },
    ];
    const answer = draw(
      slotCall([request(twoSides, { entries: entries(8) })], null, commitments),
    );
    assert({
      given:
        'a member of an entry to be placed who already sits in another event in the slot',
      should:
        'answer infeasible on the slot, naming the person and both holders',
      actual:
        answer.kind === 'infeasible' && answer.cause === 'slot'
          ? answer.collisions
          : answer.kind,
      expected: [
        {
          person: 'person-e03',
          holders: [
            { kind: 'entry', event: 'ev', entry: 'e03' },
            { kind: 'commitment', event: 'other', fixture: 'c1' },
          ],
        },
      ],
    });
  });

  test('a person entered in two events of one slot is a collision', () => {
    const shared = entry('both', null, { members: ['person-twice'] });
    const answer = draw(
      slotCall(
        [
          request(twoSides, {
            event: 'a',
            entries: [...entries(5, 5, 'a'), shared],
          }),
          request(speakers, {
            event: 'b',
            entries: [...entries(7, 7, 'b'), { ...shared, id: 'both-b' }],
          }),
        ],
        null,
      ),
    );
    assert({
      given: 'one person entered in two events drawn in one slot',
      should: 'answer infeasible naming that person',
      actual:
        answer.kind === 'infeasible' && answer.cause === 'slot'
          ? answer.collisions.map((c) => c.person)
          : answer.kind,
      expected: ['person-twice'],
    });
  });
});

describe('a windowed tab round', () => {
  test('has no slot and no commitments, asks for no availability, and seats each judge once', () => {
    const plain = judges(5).map(({ available: _available, ...j }) => j);
    const competitor = entry('e00', null, { members: ['person-j00'] });
    const answer = draw({
      call: 'windowed',
      event: request(twoSides, {
        entries: [competitor, ...entries(8).slice(1)],
      }),
      judges: plain,
      seed: seedOf(2),
    });
    const d = drawsOf(answer)[0]!;
    const seated = fixturesOf(d).flatMap((f) => panelOf(f));
    assert({
      given:
        'a windowed round, judges with no availability, one of whom competes elsewhere in the event',
      should:
        'draw with no slot, seat four distinct judges, and record no slot or commitment',
      actual: [
        d.inputs.call,
        'commitments' in d.inputs,
        seated.length,
        new Set(seated).size,
      ],
      expected: ['windowed', false, 4, 4],
    });
  });
});

describe('a re-draw', () => {
  const field = entries(8);
  const existing = [
    {
      id: 'x1',
      fixture: { kind: 'pairing', sides: ['e00', 'e01'], panel: ['j00'] },
      hold: 'fixed',
    },
    {
      id: 'x2',
      fixture: { kind: 'pairing', sides: ['e02', 'e03'], panel: [] },
      hold: 'movable',
    },
    {
      id: 'x3',
      fixture: { kind: 'pairing', sides: ['e04', 'e05'], panel: ['j01'] },
      hold: 'movable',
    },
    {
      id: 'x4',
      fixture: { kind: 'pairing', sides: ['e06', 'e07'], panel: [] },
      hold: 'movable',
    },
  ] as const;

  test('keeps every fixed fixture and every movable one the rules allow', () => {
    const withdrawn = field.map((e) =>
      e.id === 'e07' ? { ...e, status: 'withdrawn' as const } : e,
    );
    const d = drawsOf(
      draw(
        slotCall(
          [
            request(twoSides, {
              entries: [...withdrawn, entry('e08')],
              existing: existing as never,
            }),
          ],
          null,
        ),
      ),
    )[0]!;
    assert({
      given: 'four fixtures, one fixed, after e07 withdraws and e08 joins',
      should: 'keep x1, x2 and x3, withdraw x4 and add e06 against e08',
      actual: [
        d.keep.map((k) => k.id),
        d.withdraw,
        d.add.map((a) => [...entriesOf(a.fixture)].sort()),
      ],
      expected: [['x1', 'x2', 'x3'], ['x4'], [['e06', 'e08']]],
    });
  });

  test('on a kept fixture the seated judges stay and only empty seats are filled', () => {
    const d = drawsOf(
      draw(
        slotCall(
          [request(twoSides, { entries: field, existing: existing as never })],
          judges(6),
        ),
      ),
    )[0]!;
    const panels = new Map(d.keep.map((k) => [k.id, panelOf(k.fixture)]));
    assert({
      given: 'a re-draw with judges where x1 and x3 already have a judge',
      should:
        'leave j00 on x1 and j01 on x3, and fill the empty panels from the rest',
      actual: [
        panels.get('x1'),
        panels.get('x3'),
        ['j00', 'j01'].some(
          (j) => panels.get('x2')!.includes(j) || panels.get('x4')!.includes(j),
        ),
      ],
      expected: [['j00'], ['j01'], false],
    });
  });

  test('every fixture fixed with empty panels seats judges only', () => {
    const fixed = existing.map((f) => ({
      ...f,
      hold: 'fixed' as const,
      fixture: { ...f.fixture, panel: [] },
    }));
    const d = drawsOf(
      draw(
        slotCall(
          [request(twoSides, { entries: field, existing: fixed as never })],
          judges(4),
        ),
      ),
    )[0]!;
    assert({
      given: 'every fixture fixed and no judge seated',
      should: 'keep all four, add none, and seat one judge on each',
      actual: [
        d.keep.length,
        d.add.length,
        d.keep.every((k) => panelOf(k.fixture).length === 1),
      ],
      expected: [4, 0, true],
    });
  });
});
