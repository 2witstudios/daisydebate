import type { DrawCommand } from '@daisy/protocol/lobby/draw-command';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  decideDraw,
  type DrawDecision,
  type DrawFacts,
  type DrawFixtureFacts,
  type DrawVersionFacts,
} from './draw';
import type {
  EngineAssessment,
  EngineDraw,
  EngineDrawAnswer,
  EngineDrawInput,
  TabEngine,
} from './tab-engine';

setupRitewayBun();

const id = (tag: string) => tag.padEnd(24, '0');
const lobbyId = id('lobby');
const eventId = id('event');
const roundId = id('round');
const slotId = id('slot');
const seed = 'ab'.repeat(32);
const [a, b, c, d] = ['ea', 'eb', 'ec', 'ed'].map(id) as [
  string,
  string,
  string,
  string,
];
const member = (entry: string) => `${entry.slice(0, 2)}member`.padEnd(24, '0');

const noFindings: EngineAssessment = { warnings: [], broken: [], invalid: [] };

const fixture = (
  name: string,
  entries: readonly string[],
  overrides: Partial<DrawFixtureFacts> = {},
): DrawFixtureFacts => ({
  id: id(name),
  kind: 'pairing',
  status: 'published',
  roomId: id(`room${name}`),
  state: 'not_open',
  entries: entries.map((entryId, position) => ({
    entryId,
    position,
    side: position === 0 ? 'aff' : 'neg',
    members: [member(entryId)],
  })),
  judges: [],
  ...overrides,
});

const inputs = {
  engine: null,
  settingsDigest: 'digest-1',
  broken: [],
  overrides: [],
};
const version = (
  name: string,
  number: number,
  fixtureIds: readonly string[],
  overrides: Partial<DrawVersionFacts> = {},
): DrawVersionFacts => ({
  id: id(name),
  version: number,
  status: 'published',
  basedOnDrawId: null,
  inputs,
  fixtureIds,
  ...overrides,
});

const fresh = Array.from({ length: 20 }, (_, n) => id(`fresh${n}`));

/** Version 1 published f1 (a v b) and f2 (c v d); version 2 is a draft re-pairing them. */
const published1 = version('draw1', 1, [id('f1'), id('f2')]);
const draft2 = version('draw2', 2, [id('f3'), id('f4')], {
  status: 'draft',
  basedOnDrawId: id('draw1'),
});
const fixtures = [
  fixture('f1', [a, b]),
  fixture('f2', [c, d]),
  fixture('f3', [a, c], { status: 'draft', roomId: null, state: null }),
  fixture('f4', [b, d], { status: 'draft', roomId: null, state: null }),
];

const facts = (overrides: Partial<DrawFacts> = {}): DrawFacts => ({
  commandId: id('command'),
  now: '2026-11-14T12:00:00.000Z',
  freshIds: fresh,
  event: {
    id: eventId,
    lobbyId,
    name: 'Policy',
    formatId: id('format'),
    formatVersion: 1,
    templateId: null,
    ballotDefinitionId: null,
    ballotDefinitionVersion: null,
    format: { outcome: 'winner', sides: 2 },
    sideNames: ['aff', 'neg'],
  },
  tabRound: {
    id: roundId,
    number: 2,
    name: 'Round 2',
    stage: { kind: 'preliminary' },
    timing: 'live',
    timeSlot: { id: slotId, version: 4 },
  },
  versions: [published1, draft2],
  fixtures,
  settings: { kind: 'resolved', values: {}, digest: 'digest-1' },
  engine: {
    entries: [],
    history: { fixtures: [], results: [] },
    ratings: null,
    judges: [],
    commitments: [],
  },
  breakChoicesPending: false,
  slotElsewhere: [],
  releasesAtOnce: [],
  ...overrides,
});

const engineReturning = (answer: EngineDrawAnswer, assessment = noFindings) => {
  const calls: EngineDrawInput[] = [];
  const engine: TabEngine = {
    draw: (input) => {
      calls.push(input);
      return answer;
    },
    assess: (_, plans) => plans.map(() => assessment),
  };
  return { engine, calls };
};
const unused: TabEngine = {
  draw: () => {
    throw new Error('not called');
  },
  assess: () => {
    throw new Error('not called');
  },
};

const engineDraw = (overrides: Partial<EngineDraw> = {}): EngineDraw => ({
  event: eventId,
  keep: [],
  add: [],
  withdraw: [],
  assessment: noFindings,
  inputs: {
    engine: { method: 'two-sided@1' },
    settingsDigest: 'digest-1',
    seed,
    cutoff: 1,
    results: [id('result1')],
  },
  ...overrides,
});

const refusalOf = (decision: DrawDecision) =>
  decision.kind === 'refused' ? decision.refusal : 'accepted';
const writesOf = (decision: DrawDecision) =>
  decision.kind === 'accepted' ? decision.writes : [];
const tablesOf = (decision: DrawDecision) =>
  writesOf(decision).map((write) => `${write.table}.${write.op}`);

const generate: DrawCommand = {
  type: 'generate-draw',
  tabRoundId: roundId,
  resultCutoff: 1,
  seed,
};
const publish = (
  overrides: Partial<Extract<DrawCommand, { type: 'publish-draw' }>> = {},
): DrawCommand => ({
  type: 'publish-draw',
  drawId: id('draw2'),
  overrides: [],
  ...overrides,
});

describe('generate-draw', () => {
  test('stores a draft of the fixtures the engine keeps and adds', () => {
    const { engine, calls } = engineReturning({
      kind: 'drawn',
      draws: [
        engineDraw({
          keep: [
            {
              id: id('f1'),
              fixture: { kind: 'pairing', sides: [a, b], panel: [] },
            },
          ],
          add: [
            {
              ordinal: 0,
              fixture: { kind: 'pairing', sides: [d, c], panel: [] },
            },
          ],
          withdraw: [id('f2')],
        }),
      ],
    });
    const decision = decideDraw(engine)(
      facts({ versions: [published1] }),
      generate,
    );
    const input = calls[0];
    assert({
      given: 'an engine keeping one live fixture and re-pairing the other',
      should:
        'pass live fixtures as movable in a slot call, and write version 2 with one new fixture',
      actual: {
        call: input?.call,
        holds:
          input?.call === 'slot'
            ? input.events[0]?.existing.map((e) => e.hold)
            : null,
        version:
          decision.kind === 'accepted' ? decision.resultingVersion : null,
        tables: tablesOf(decision),
        sides: writesOf(decision).flatMap((write) =>
          write.table === 'fixture_entries' && write.op === 'insert'
            ? [[write.row.entryId, write.row.side]]
            : [],
        ),
      },
      expected: {
        call: 'slot',
        holds: ['movable', 'movable'],
        version: 2,
        tables: [
          'draws.insert',
          'fixtures.insert',
          'fixture_entries.insert',
          'fixture_entries.insert',
          'draw_fixtures.insert',
          'draw_fixtures.insert',
          'draw_result_inputs.insert',
        ],
        sides: [
          [d, 'aff'],
          [c, 'neg'],
        ],
      },
    });
  });

  test('a fixture with a live Round goes in as fixed', () => {
    const { engine, calls } = engineReturning({
      kind: 'infeasible',
      cause: 'slot',
    });
    decideDraw(engine)(
      facts({
        fixtures: [
          fixture('f1', [a, b], { state: 'round_live' }),
          fixture('f2', [c, d]),
        ],
      }),
      generate,
    );
    const input = calls[0];
    assert({
      given: 'a live fixture whose Round is live',
      should: 'hold it fixed',
      actual:
        input?.call === 'slot'
          ? input.events[0]?.existing.map((e) => e.hold)
          : null,
      expected: ['fixed', 'movable'],
    });
  });

  test('no version is made when the set of fixtures does not change', () => {
    const { engine } = engineReturning({
      kind: 'drawn',
      draws: [
        engineDraw({
          keep: [
            {
              id: id('f1'),
              fixture: { kind: 'pairing', sides: [a, b], panel: [] },
            },
            {
              id: id('f2'),
              fixture: { kind: 'pairing', sides: [c, d], panel: [] },
            },
          ],
        }),
      ],
    });
    assert({
      given: 'an engine keeping every live fixture',
      should: 'refuse draw-unchanged',
      actual: refusalOf(
        decideDraw(engine)(facts({ versions: [published1] }), generate),
      ),
      expected: 'draw-unchanged',
    });
  });

  test('each engine answer and missing input refuses by name', () => {
    const run = (
      answer: EngineDrawAnswer,
      overrides: Partial<DrawFacts> = {},
    ) =>
      refusalOf(
        decideDraw(engineReturning(answer).engine)(facts(overrides), generate),
      );
    const drawn: EngineDrawAnswer = { kind: 'drawn', draws: [engineDraw()] };
    assert({
      given:
        'incomplete settings, a pending break choice, and each engine refusal',
      should: 'name each refusal',
      actual: [
        run(drawn, { settings: { kind: 'incomplete' } }),
        run(drawn, { breakChoicesPending: true }),
        run({
          kind: 'infeasible',
          cause: 'structure',
          event: eventId,
          fact: 'missing_result',
        }),
        run({ kind: 'infeasible', cause: 'rules', event: eventId }),
        run({
          kind: 'unresolved',
          event: eventId,
          attempt: engineDraw(),
          broken: [],
        }),
        refusalOf(
          decideDraw(unused)(facts(), { ...generate, tabRoundId: id('other') }),
        ),
      ],
      expected: [
        'settings-incomplete',
        'choices-pending',
        'results-incomplete',
        'rule-unsatisfiable',
        'draw-unresolved',
        'not-found',
      ],
    });
  });
});

describe('assign-judges', () => {
  const assign: DrawCommand = { type: 'assign-judges', drawId: id('draw1') };
  const judge = {
    id: id('judge1'),
    person: id('judgeperson'),
    protection: [],
    events: null,
    conflicts: [],
    strikes: [],
    judged: [],
    tabRoundsJudged: 0,
    outstandingBallots: 0,
    chair: true,
    available: true,
  };

  test('fills empty seats on the fixtures, makes no draw version and answers each change', () => {
    const { engine, calls } = engineReturning({
      kind: 'drawn',
      draws: [
        engineDraw({
          keep: [
            {
              id: id('f1'),
              fixture: {
                kind: 'pairing',
                sides: [a, b],
                panel: [id('judge1')],
              },
            },
            {
              id: id('f2'),
              fixture: { kind: 'pairing', sides: [c, d], panel: [] },
            },
          ],
        }),
      ],
    });
    const decision = decideDraw(engine)(
      facts({ engine: { ...facts().engine, judges: [judge] } }),
      assign,
    );
    const input = calls[0];
    assert({
      given: 'a published draw and one available judge',
      should:
        'seat the judge as chair, bump the slot, keep the draw version and answer one change',
      actual: {
        holds:
          input?.call === 'slot'
            ? input.events[0]?.existing.map((e) => e.hold)
            : null,
        judges: input?.judges?.length,
        version:
          decision.kind === 'accepted' ? decision.resultingVersion : null,
        writes: writesOf(decision),
        changes:
          decision.kind === 'accepted'
            ? decision.fixtureChanges.map((c) => [c.kind, c.fixtureId])
            : [],
      },
      expected: {
        holds: ['fixed', 'fixed'],
        judges: 1,
        version: 1,
        writes: [
          {
            table: 'fixture_judges',
            op: 'insert',
            row: {
              tabRoundId: roundId,
              eventId,
              lobbyId,
              fixtureId: id('f1'),
              fixtureStatus: 'published',
              tournamentJudgeId: id('judge1'),
              chair: true,
            },
          },
          {
            table: 'time_slots',
            op: 'update',
            where: { id: slotId, version: 4 },
            set: { version: 5 },
          },
        ],
        changes: [['officiated', id('f1')]],
      },
    });
  });

  test('short panels and double bookings refuse by name', () => {
    const run = (answer: EngineDrawAnswer) =>
      refusalOf(decideDraw(engineReturning(answer).engine)(facts(), assign));
    assert({
      given: 'too few judges, a slot collision and a judge seated twice',
      should: 'name each refusal',
      actual: [
        run({ kind: 'infeasible', cause: 'panels', draws: [] }),
        run({ kind: 'infeasible', cause: 'slot' }),
        run({
          kind: 'drawn',
          draws: [
            engineDraw({
              assessment: { ...noFindings, invalid: [{ fact: 'judge_twice' }] },
            }),
          ],
        }),
      ],
      expected: [
        'judges-insufficient',
        'judge-double-booked',
        'judge-double-booked',
      ],
    });
  });
});

describe('edit-draw', () => {
  const edit = (
    edits: Extract<DrawCommand, { type: 'edit-draw' }>['edits'],
    basedOnDrawId = id('draw2'),
  ): DrawCommand => ({ type: 'edit-draw', basedOnDrawId, edits });

  test('an edited fixture is replaced; an untouched one is the same fixture', () => {
    const { engine } = engineReturning(
      { kind: 'infeasible', cause: 'slot' },
      {
        warnings: [],
        broken: [
          {
            event: eventId,
            key: 'pairing.rematch',
            fixture: { kind: 'new', ordinal: 0 },
          },
        ],
        invalid: [],
      },
    );
    const decision = decideDraw(engine)(
      facts(),
      edit([{ type: 'swap-sides', fixtureId: id('f3') }]),
    );
    const held = writesOf(decision).flatMap((write) =>
      write.table === 'draw_fixtures' && write.op === 'insert'
        ? [write.row.fixtureId]
        : [],
    );
    const draw = writesOf(decision).find((write) => write.table === 'draws');
    assert({
      given: 'sides swapped on one fixture of the latest draft',
      should:
        'write a typed version 3 holding a new fixture and the untouched one, recording the broken rule',
      actual: {
        version:
          decision.kind === 'accepted' ? decision.resultingVersion : null,
        held,
        draw:
          draw?.op === 'insert'
            ? [draw.row.method, draw.row.basedOnDrawId, draw.row.inputs.broken]
            : null,
        findings:
          decision.kind === 'accepted'
            ? decision.findings.map((f) => f.key)
            : [],
      },
      expected: {
        version: 3,
        held: [fresh[1], id('f4')],
        draw: ['typed', id('draw1'), ['pairing.rematch']],
        findings: ['pairing.rematch'],
      },
    });
  });

  test('each rule refuses by name', () => {
    const started = facts({
      versions: [published1],
      fixtures: [
        fixture('f1', [a, b], { state: 'ballot_in' }),
        fixture('f2', [c, d]),
      ],
    });
    const { engine } = engineReturning({ kind: 'infeasible', cause: 'slot' });
    assert({
      given:
        'an edit on an older version, on a fixture with a ballot, and on an unknown fixture',
      should: 'name each refusal',
      actual: [
        decideDraw(engine)(
          facts(),
          edit([{ type: 'swap-sides', fixtureId: id('f1') }], id('draw1')),
        ),
        decideDraw(engine)(
          started,
          edit([{ type: 'swap-sides', fixtureId: id('f1') }], id('draw1')),
        ),
        decideDraw(engine)(
          started,
          edit([{ type: 'set-bye', entryId: a }], id('draw1')),
        ),
        decideDraw(engine)(
          facts(),
          edit([{ type: 'remove-fixture', fixtureId: id('nope') }]),
        ),
      ].map(refusalOf),
      expected: [
        'stale-draft',
        'fixture-started',
        'fixture-started',
        'not-found',
      ],
    });
  });

  test('a bye replaces the fixture the entry left', () => {
    const { engine } = engineReturning({ kind: 'infeasible', cause: 'slot' });
    assert({
      given: 'an entry of a pairing set to a bye',
      should: 'make two new fixtures: the bye and what is left of the pairing',
      actual: tablesOf(
        decideDraw(engine)(facts(), edit([{ type: 'set-bye', entryId: a }])),
      ).filter((t) => t === 'fixtures.insert').length,
      expected: 2,
    });
  });
});

describe('publish-draw', () => {
  test('withdraws what it leaves out, publishes the new fixtures and answers exactly the changes', () => {
    const decision = decideDraw(unused)(
      facts({
        releasesAtOnce: [{ thing: 'posting', audience: 'participants' }],
      }),
      publish(),
    );
    assert({
      given: 'a draft re-pairing both live fixtures',
      should:
        'withdraw both, close their Rooms, open a Room per new fixture and list the changes',
      actual: {
        tables: tablesOf(decision).filter(
          (t) => t !== 'room_participants.insert',
        ),
        changes:
          decision.kind === 'accepted'
            ? decision.fixtureChanges.map((change) => [
                change.kind,
                change.fixtureId,
                change.people,
              ])
            : [],
      },
      expected: {
        tables: [
          'fixtures.update',
          'rooms.update',
          'fixtures.update',
          'rooms.update',
          'rooms.insert',
          'fixtures.update',
          'rooms.insert',
          'fixtures.update',
          'draws.update',
          'releases.insert',
          'time_slots.update',
        ],
        changes: [
          ['added', id('f3'), [member(a), member(c)]],
          ['added', id('f4'), [member(b), member(d)]],
          ['withdrawn', id('f1'), [member(a), member(b)]],
          ['withdrawn', id('f2'), [member(c), member(d)]],
        ],
      },
    });
  });

  test('a publish with the same set of fixtures as the last is refused', () => {
    const same = version('draw2', 2, [id('f2'), id('f1')], {
      status: 'draft',
      basedOnDrawId: id('draw1'),
    });
    assert({
      given: 'a draft holding exactly the published fixtures',
      should: 'refuse draw-unchanged',
      actual: refusalOf(
        decideDraw(unused)(facts({ versions: [published1, same] }), publish()),
      ),
      expected: 'draw-unchanged',
    });
  });

  test('a publish leaving out a fixture with a live Round, a ballot or a result is refused', () => {
    const leaving = (
      state: 'round_live' | 'ballot_in' | 'has_result' | 'open',
    ) =>
      refusalOf(
        decideDraw(unused)(
          facts({
            fixtures: [fixture('f1', [a, b], { state }), ...fixtures.slice(1)],
          }),
          publish(),
        ),
      );
    assert({
      given: 'the left-out fixture in each state',
      should: 'refuse fixture-started unless its Round has not started',
      actual: (['round_live', 'ballot_in', 'has_result', 'open'] as const).map(
        leaving,
      ),
      expected: [
        'fixture-started',
        'fixture-started',
        'fixture-started',
        'accepted',
      ],
    });
  });

  test('a rule override without a reason is refused', () => {
    const breaking = facts({
      versions: [
        published1,
        { ...draft2, inputs: { ...inputs, broken: ['pairing.rematch'] } },
      ],
    });
    const decision = decideDraw(unused)(
      breaking,
      publish({
        overrides: [{ key: 'pairing.rematch', reason: 'Two schools only' }],
      }),
    );
    const drawWrite = writesOf(decision).find(
      (write) => write.table === 'draws',
    );
    assert({
      given:
        'a draft breaking a rule, published with no override, a blank reason and a reason',
      should:
        'refuse rule-broken and reason-required, then record the override on the draw',
      actual: [
        refusalOf(decideDraw(unused)(breaking, publish())),
        refusalOf(
          decideDraw(unused)(
            breaking,
            publish({ overrides: [{ key: 'pairing.rematch', reason: '  ' }] }),
          ),
        ),
        drawWrite?.op === 'update' ? drawWrite.set.inputs.overrides : null,
      ],
      expected: [
        'rule-broken',
        'reason-required',
        [{ key: 'pairing.rematch', reason: 'Two schools only' }],
      ],
    });
  });

  test('each other rule refuses by name', () => {
    const run = (overrides: Partial<DrawFacts>, command = publish()) =>
      refusalOf(decideDraw(unused)(facts(overrides), command));
    const judged = (name: string, entries: readonly string[]) =>
      fixture(name, entries, {
        status: 'draft',
        roomId: null,
        state: null,
        judges: [
          {
            tournamentJudgeId: id('judge1'),
            person: id('judgeperson'),
            chair: true,
          },
        ],
      });
    assert({
      given:
        'a published draw, a stale base, no slot, changed settings, a judge twice and a person elsewhere in the slot',
      should: 'name each refusal',
      actual: [
        run({}, publish({ drawId: id('draw1') })),
        run({ versions: [published1, { ...draft2, basedOnDrawId: null }] }),
        run({ tabRound: { ...facts().tabRound, timeSlot: null } }),
        run({ settings: { kind: 'resolved', values: {}, digest: 'digest-2' } }),
        run({
          fixtures: [
            ...fixtures.slice(0, 2),
            judged('f3', [a, c]),
            judged('f4', [b, d]),
          ],
        }),
        run({ slotElsewhere: [member(a)] }),
        run({}, publish({ drawId: id('nope') })),
      ],
      expected: [
        'stale-draft',
        'stale-draft',
        'slot-unset',
        'inputs-changed',
        'judge-double-booked',
        'slot-clash',
        'not-found',
      ],
    });
  });
});

describe('discard-draft', () => {
  test('removes the draft and the unpublished fixtures no other draft holds', () => {
    assert({
      given:
        'a draft whose two fixtures no other version holds, and a published draw',
      should:
        'delete both fixtures with the draft, and refuse the published one',
      actual: [
        tablesOf(
          decideDraw(unused)(facts(), {
            type: 'discard-draft',
            drawId: id('draw2'),
          }),
        ),
        refusalOf(
          decideDraw(unused)(facts(), {
            type: 'discard-draft',
            drawId: id('draw1'),
          }),
        ),
      ],
      expected: [
        [
          'draws.delete',
          'fixture_entries.delete',
          'fixture_judges.delete',
          'fixtures.delete',
          'fixture_entries.delete',
          'fixture_judges.delete',
          'fixtures.delete',
        ],
        'stale-draft',
      ],
    });
  });
});
