import { shuffleWith, wordStream } from '@daisy/seeded-random';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type {
  Commitment,
  DrawInput,
  EventRequest,
  SlotJudge,
} from '../shapes/draw';
import { check } from '../checker';
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

describe('a movable fixture whose judge is busy elsewhere in the slot', () => {
  test('is withdrawn rather than kept with a person in two fixtures', () => {
    const field = [
      ...entries(4),
      entry('e04', null, { members: ['person-j00'] }),
      ...entries(8).slice(5),
    ];
    const existing = [
      {
        id: 'm1',
        fixture: { kind: 'pairing', sides: ['e00', 'e01'], panel: ['j00'] },
        hold: 'movable',
      },
    ];
    const d = drawsOf(
      draw(
        slotCall(
          [request(twoSides, { entries: field, existing: existing as never })],
          judges(6),
        ),
      ),
    )[0]!;
    assert({
      given:
        'a movable fixture judged by a person who is also a member of another entry in the slot',
      should: 'withdraw it, and seat that person nowhere as a judge',
      actual: [
        d.withdraw,
        [...d.keep, ...d.add].some(
          (f) => f.fixture.kind !== 'bye' && f.fixture.panel.includes('j00'),
        ),
      ],
      expected: [['m1'], false],
    });
  });
});

describe('one judge seated on two movable fixtures', () => {
  const pair = (
    id: string,
    sides: readonly [string, string],
    hold: 'fixed' | 'movable' = 'movable',
    judge = 'j00',
  ) => ({
    id,
    fixture: { kind: 'pairing', sides, panel: [judge] },
    hold,
  });
  const keptAndWithdrawn = (input: DrawInput) => {
    const answer = draw(input);
    return [
      drawsOf(answer).map((d) => [d.keep.map((k) => k.id), d.withdraw]),
      check(input, answer).ok,
    ];
  };

  test('in one event: the first fixture in canonical order keeps the judge, and the checker agrees', () => {
    assert({
      given: 'j00 seated on two movable fixtures of one event',
      should: 'keep m1, withdraw m2, and pass the checker',
      actual: keptAndWithdrawn(
        slotCall(
          [
            request(twoSides, {
              entries: entries(8),
              existing: [
                pair('m1', ['e00', 'e01']),
                pair('m2', ['e02', 'e03']),
              ] as never,
            }),
          ],
          judges(6),
        ),
      ),
      expected: [[[['m1'], ['m2']]], true],
    });
  });

  test('a windowed tab round holds the same rule', () => {
    assert({
      given: 'j00 seated on two movable fixtures of a windowed tab round',
      should: 'keep m1, withdraw m2, and pass the checker',
      actual: keptAndWithdrawn({
        call: 'windowed',
        event: request(twoSides, {
          entries: entries(8),
          existing: [
            pair('m1', ['e00', 'e01']),
            pair('m2', ['e02', 'e03']),
          ] as never,
        }),
        judges: judges(6).map(({ available: _available, ...j }) => j),
        seed: seedOf(6),
      }),
      expected: [[[['m1'], ['m2']]], true],
    });
  });

  test('a fixed fixture holds its judge before a movable one', () => {
    assert({
      given:
        'j00 seated on a fixed fixture and a movable one of the same event',
      should: 'keep the fixed f1, withdraw m2, and pass the checker',
      actual: keptAndWithdrawn(
        slotCall(
          [
            request(twoSides, {
              entries: entries(8),
              existing: [
                pair('f1', ['e00', 'e01'], 'fixed'),
                pair('m2', ['e02', 'e03']),
              ] as never,
            }),
          ],
          judges(6),
        ),
      ),
      expected: [[[['f1'], ['m2']]], true],
    });
  });

  test('in two events of a slot: the first event keeps the judge, and the checker agrees', () => {
    assert({
      given:
        'j00 seated on a movable fixture in each of two events in one slot',
      should:
        "keep event a's fixture, withdraw event b's, and pass the checker",
      actual: keptAndWithdrawn(
        slotCall(
          [
            request(twoSides, {
              event: 'a',
              entries: entries(4, 4, 'a'),
              existing: [pair('ma', ['a00', 'a01'])] as never,
            }),
            request(twoSides, {
              event: 'b',
              entries: entries(4, 4, 'b'),
              existing: [pair('mb', ['b00', 'b01'])] as never,
            }),
          ],
          judges(6),
        ),
      ),
      expected: [
        [
          [['ma'], []],
          [[], ['mb']],
        ],
        true,
      ],
    });
  });

  test('a judge freed when its section is released stays free for the next event', () => {
    const section = (
      id: string,
      speakers: readonly string[],
      judge: string,
    ) => ({
      id,
      fixture: { kind: 'section', speakers, panel: [judge] },
      hold: 'movable',
    });
    const speech = [
      ...['x1', 'x2', 'x3', 'x4'].map((id) => entry(id, 'X')),
      ...['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'].map(
        (id) => entry(id, id),
      ),
    ];
    const input = slotCall(
      [
        request(speakers, {
          event: 'a',
          entries: speech,
          settings: withSettings({
            'pairing.same_school': { force: 'rule' },
            'pairing.section_size': { target: 4 },
          }),
          existing: [
            section('m1', ['x1', 'a', 'b', 'c'], 'j00'),
            section('m2', ['d', 'e', 'f', 'g'], 'j01'),
          ] as never,
        }),
        request(twoSides, {
          event: 'b',
          entries: entries(4, 4, 'b'),
          existing: [pair('mb', ['b00', 'b01'], 'movable', 'j01')] as never,
        }),
      ],
      judges(12),
    );
    const answer = draw(input);
    const [a, b] = drawsOf(answer);
    assert({
      given:
        'a speech event that must release m2 (judged by j01), and another event whose movable fixture j01 also judges',
      should: 'withdraw m2, keep mb, and pass the checker',
      actual: [a!.withdraw, b!.keep.map((k) => k.id), check(input, answer).ok],
      expected: [['m2'], ['mb'], true],
    });
  });

  test('a judge claimed by a section the counting proof withdraws stays free for the next section of the event', () => {
    const section = (id: string, speakers: readonly string[]) => ({
      id,
      fixture: { kind: 'section', speakers, panel: ['j00'] },
      hold: 'movable',
    });
    const speech = [
      ...['x1', 'x2', 'x3', 'x4'].map((id) => entry(id, 'X')),
      ...['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'].map(
        (id) => entry(id, id),
      ),
    ];
    const input = slotCall(
      [
        request(speakers, {
          entries: speech,
          settings: withSettings({
            'pairing.same_school': { force: 'rule' },
            'pairing.section_size': { target: 4 },
          }),
          existing: [
            section('a2', ['d', 'e', 'f', 'g']),
            section('b1', ['x1', 'a', 'b', 'c']),
          ] as never,
        }),
      ],
      judges(8),
    );
    const answer = draw(input);
    const [d] = drawsOf(answer);
    assert({
      given:
        'two movable sections sharing j00, where the counting proof must release a2',
      should: 'keep b1 with j00, withdraw only a2, and pass the checker',
      actual: [d!.keep.map((k) => k.id), d!.withdraw, check(input, answer).ok],
      expected: [['b1'], ['a2'], true],
    });
  });
});

describe('movable sections sharing judges under a counting proof', () => {
  test('every seeded case returns, never seats a judge twice, and passes the checker', () => {
    const failures: string[] = [];
    for (let n = 0; n < 400; n += 1) {
      const stream = wordStream(
        'test/movable-sections',
        new Uint8Array([n, n >> 8]),
        new Uint8Array(),
      );
      let at = 0;
      const next = (below: number) => stream(at++) % below;
      const schools = ['W', 'Z', 'Y'];
      const speech = Array.from({ length: 16 }, (_, i) =>
        entry(
          `p${String(i).padStart(2, '0')}`,
          next(3) === 0 ? schools[next(3)]! : `own${i}`,
        ),
      );
      const shuffled = shuffleWith(
        speech.map((e) => e.id),
        stream,
      );
      const movable = Array.from({ length: 2 + next(3) }, (_, k) => ({
        id: `s${String.fromCharCode(97 + k)}`,
        fixture: {
          kind: 'section',
          speakers: shuffled.slice(4 * k, 4 * k + 4),
          panel: [`j0${next(2)}`],
        },
        hold: 'movable',
      }));
      const input = slotCall(
        [
          request(speakers, {
            entries: speech,
            settings: withSettings({
              'pairing.same_school': { force: 'rule' },
              'pairing.section_size': { target: 4 },
            }),
            existing: movable as never,
          }),
        ],
        judges(8),
      );
      const answer = draw(input);
      const verdict = check(input, answer);
      if (!verdict.ok)
        failures.push(
          `case ${n}: ${answer.kind} ${JSON.stringify(verdict.violations).slice(0, 200)}`,
        );
    }
    assert({
      given:
        '150 seeded speech fields with three movable sections, some sharing a judge, under a same-school rule',
      should: 'answer every one, accepted by the checker',
      actual: failures,
      expected: [],
    });
  });
});

describe('a section kept without a claim beside another on its judge', () => {
  test('releases the later one and ends: the loop over keeps terminates', () => {
    const field = [
      entry('z1', 'Z'),
      ...['a1', 'a2', 'a3'].map((id) => entry(id, id)),
      entry('w1', 'W'),
      ...['b1', 'b2', 'b3'].map((id) => entry(id, id)),
      ...['c1', 'c2', 'c3', 'c4'].map((id) => entry(id, id)),
      entry('w2', 'W'),
      entry('w3', 'W'),
      entry('z2', 'Z'),
      entry('z3', 'Z'),
    ];
    const section = (
      id: string,
      speakers: readonly string[],
      judge: string,
    ) => ({
      id,
      fixture: { kind: 'section', speakers, panel: [judge] },
      hold: 'movable',
    });
    const input = slotCall(
      [
        request(speakers, {
          entries: field,
          settings: withSettings({
            'pairing.same_school': { force: 'rule' },
            'pairing.section_size': { target: 4 },
          }),
          existing: [
            section('sa', ['z1', 'a1', 'a2', 'a3'], 'j00'),
            section('sb', ['w1', 'b1', 'b2', 'b3'], 'j00'),
            section('sc', ['c1', 'c2', 'c3', 'c4'], 'j01'),
          ] as never,
        }),
      ],
      judges(8),
    );
    const answer = draw(input);
    const [d] = drawsOf(answer);
    assert({
      given:
        'sections sa and sb sharing j00, where W binds while sa is kept and Z and W bind once sb is',
      should:
        'answer, keep one section, withdraw the other two, and pass the checker',
      actual: [d!.keep.length, d!.withdraw.length, check(input, answer).ok],
      expected: [1, 2, true],
    });
  });
});
