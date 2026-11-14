import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { FixtureCommand } from '@daisy/protocol/lobby/fixture-command';
import {
  decideFixture,
  fixtureStateOf,
  type FixtureFacts,
  type FixtureState,
  type TournamentJudgeRow,
} from './fixture';

setupRitewayBun();

const id = (letter: string) => letter.repeat(24);
const fixtureId = id('f');
const judge = (
  letter: string,
  over: Partial<TournamentJudgeRow> = {},
): TournamentJudgeRow => ({
  id: id(letter),
  actorId: id('9'),
  schoolOrganizationId: null,
  status: 'accepted',
  chairQualified: true,
  availableInSlot: true,
  allowedEvent: true,
  ...over,
});

/** A published pairing whose Round has not started, with one judge (j) on a panel of three. */
const base: FixtureFacts = {
  commandId: id('c'),
  now: '2026-11-14T10:00:00.000Z',
  minted: { resultId: id('r'), roomId: id('m') },
  fixture: {
    id: fixtureId,
    lobbyId: id('l'),
    eventId: id('v'),
    tabRoundId: id('t'),
    kind: 'pairing',
    status: 'published',
    roomId: id('o'),
    version: 4,
  },
  entries: [
    { entryId: id('a'), side: 'affirmative', schoolOrganizationId: id('s') },
    { entryId: id('b'), side: 'negative', schoolOrganizationId: null },
  ],
  members: [
    { entryId: id('a'), actorId: id('1') },
    { entryId: id('b'), actorId: id('2') },
  ],
  panel: [{ tournamentJudgeId: id('j'), chair: true }],
  round: null,
  ballots: [],
  results: [],
  stageKind: 'preliminary',
  judgingPanel: {
    preliminary: { size: 3, decision: 'majority' },
    elimination: { size: 3, decision: 'majority' },
  },
  judgingForces: {
    'judging.availability': 'rule',
    'judging.strike': 'rule',
    'judging.conflict': 'rule',
    'judging.same_school': 'preference',
    'judging.chair': 'preference',
  },
  judges: [
    judge('j', { actorId: id('3') }),
    judge('k', { actorId: id('4') }),
    judge('n', { actorId: id('5') }),
  ],
  strikes: [],
  slotBookings: [],
};

const round = { id: id('d'), status: 'active' } as const;
const ballot = { id: id('x'), judgeActorId: id('3'), winner: 'affirmative' };
const result = {
  id: id('q'),
  kind: 'decided',
  administrativeReason: null,
  roundId: id('d'),
  supersedesResultId: null,
  recordedAt: '2026-11-14T09:00:00.000Z',
} as const;

const inState: Record<FixtureState, FixtureFacts> = {
  draft: {
    ...base,
    fixture: { ...base.fixture, status: 'draft', roomId: null },
  },
  not_started: base,
  round_started: { ...base, round },
  ballot_in: { ...base, round, ballots: [ballot] },
  has_result: { ...base, round, ballots: [ballot], results: [result] },
  withdrawn: { ...base, fixture: { ...base.fixture, status: 'withdrawn' } },
};

const assign: FixtureCommand = {
  type: 'assign-judge',
  fixtureId,
  judgeId: id('k'),
  chair: false,
  overrides: [],
};
const replace: FixtureCommand = {
  type: 'replace-judge',
  fixtureId,
  outJudgeId: id('j'),
  inJudgeId: id('k'),
  overrides: [],
};
const unassign: FixtureCommand = {
  type: 'unassign-judge',
  fixtureId,
  judgeId: id('j'),
};
const restart: FixtureCommand = {
  type: 'restart-fixture',
  fixtureId,
  reason: 'Both sides lost audio',
};
const forfeit: FixtureCommand = {
  type: 'record-forfeit',
  fixtureId,
  entryId: id('b'),
  reason: 'No show',
};

const refusalOf = (facts: FixtureFacts, command: FixtureCommand) => {
  const decision = decideFixture(facts, command);
  return decision.kind === 'refused' ? decision.refusal : 'accepted';
};

test('the fixture state is one function of the facts', () => {
  assert({
    given: 'facts in each row of the state table',
    should: 'read that row',
    actual: Object.values(inState).map(fixtureStateOf),
    expected: Object.keys(inState),
  });
});

test('judge commands are refused in the states the state table refuses', () => {
  const states = Object.keys(inState) as FixtureState[];
  // Unassigning j once j has submitted is its own refusal; another judge is used there.
  const unassignOther: FixtureCommand = { ...unassign, judgeId: id('k') };
  const withK = (facts: FixtureFacts): FixtureFacts => ({
    ...facts,
    panel: [...facts.panel, { tournamentJudgeId: id('k'), chair: false }],
  });
  assert({
    given: 'assign-judge in each state',
    should:
      'be allowed until a result, and refused on a result or a withdrawal',
    actual: states.map((state) => refusalOf(inState[state], assign)),
    expected: [
      'accepted',
      'accepted',
      'accepted',
      'accepted',
      'result-exists',
      'fixture-withdrawn',
    ],
  });
  assert({
    given: 'unassign-judge of a judge with no ballot in each state',
    should:
      'be allowed until a result, and refused on a result or a withdrawal',
    actual: states.map((state) =>
      refusalOf(withK(inState[state]), unassignOther),
    ),
    expected: [
      'accepted',
      'accepted',
      'accepted',
      'accepted',
      'result-exists',
      'fixture-withdrawn',
    ],
  });
  assert({
    given:
      'replace-judge of a judge with no ballot in each state but ballot_in',
    should:
      'be allowed until a result, and refused on a result or a withdrawal',
    actual: states
      .filter((state) => state !== 'ballot_in')
      .map((state) => refusalOf(inState[state], replace)),
    expected: [
      'accepted',
      'accepted',
      'accepted',
      'result-exists',
      'fixture-withdrawn',
    ],
  });
  assert({
    given: 'a judge who has submitted, once a ballot is in',
    should: 'refuse their unassignment and replacement ballot-submitted',
    actual: [
      refusalOf(inState.ballot_in, unassign),
      refusalOf(inState.ballot_in, replace),
    ],
    expected: ['ballot-submitted', 'ballot-submitted'],
  });
  assert({
    given: 'a judge command on a bye',
    should: 'refuse it fixture-bye',
    actual: refusalOf(
      { ...base, fixture: { ...base.fixture, kind: 'bye', roomId: null } },
      assign,
    ),
    expected: 'fixture-bye',
  });
});

test('an assigned judge joins the fixture with no draw version', () => {
  const decision = decideFixture(base, assign);
  assert({
    given: 'assign-judge on a published fixture',
    should:
      'seat the judge, bump the fixture and answer exactly that command as a fixture change',
    actual: decision,
    expected: {
      kind: 'accepted',
      aggregate: { kind: 'fixture', id: fixtureId },
      resultingVersion: 5,
      writes: [
        {
          table: 'fixture_judges',
          op: 'insert',
          row: {
            fixtureId,
            tabRoundId: id('t'),
            eventId: id('v'),
            lobbyId: id('l'),
            fixtureStatus: 'published',
            tournamentJudgeId: id('k'),
            chair: false,
          },
        },
        { table: 'fixtures', op: 'update', id: fixtureId, set: { version: 5 } },
      ],
      findings: [],
      fixtureChanges: [
        {
          kind: 'officiated',
          fixtureId,
          tabRoundId: id('t'),
          commandId: id('c'),
          type: 'assign-judge',
          people: [id('1'), id('2'), id('3'), id('4')],
        },
      ],
    },
  });
  const officiating = [assign, replace, unassign].map((command) =>
    decideFixture(inState.round_started, command),
  );
  assert({
    given: 'each judge command',
    should: 'write no draw, no fixture entry and no draw version',
    actual: officiating.map(
      (outcome) =>
        outcome.kind === 'accepted' &&
        outcome.writes.every(
          (write) => !['draws', 'fixture_entries'].includes(write.table),
        ) &&
        !JSON.stringify(outcome).includes('drawVersion') &&
        outcome.fixtureChanges.length === 1 &&
        outcome.fixtureChanges[0]?.kind === 'officiated',
    ),
    expected: [true, true, true],
  });
  assert({
    given: 'assign-judge on a draft fixture',
    should: 'tell nobody (the fixture is not yet published)',
    actual: (() => {
      const outcome = decideFixture(inState.draft, assign);
      return outcome.kind === 'accepted' ? outcome.fixtureChanges : outcome;
    })(),
    expected: [],
  });
});

test('assign-judge checks the panel, the judge and the judging rules', () => {
  const full: FixtureFacts = {
    ...base,
    panel: [
      { tournamentJudgeId: id('j'), chair: true },
      { tournamentJudgeId: id('n'), chair: false },
      { tournamentJudgeId: id('w'), chair: false },
    ],
  };
  const withJudge = (over: Partial<TournamentJudgeRow>): FixtureFacts => ({
    ...base,
    judges: base.judges.map((row) =>
      row.id === id('k') ? { ...row, ...over } : row,
    ),
  });
  const struck: FixtureFacts = {
    ...base,
    strikes: [
      { entryId: id('a'), tournamentJudgeId: id('k'), source: 'entry' },
    ],
  };
  assert({
    given: 'each way the judge or panel cannot take the assignment',
    should: 'refuse it by name',
    actual: [
      refusalOf(full, assign),
      refusalOf(base, { ...assign, judgeId: id('j') }),
      refusalOf(base, { ...assign, judgeId: id('z') }),
      refusalOf(withJudge({ status: 'invited' }), assign),
      refusalOf(withJudge({ allowedEvent: false }), assign),
      refusalOf(
        {
          ...base,
          slotBookings: [{ fixtureId: id('g'), tournamentJudgeId: id('k') }],
        },
        assign,
      ),
      refusalOf(struck, assign),
      refusalOf(withJudge({ availableInSlot: false }), assign),
      refusalOf(struck, {
        ...assign,
        overrides: [{ key: 'judging.strike', reason: '  ' }],
      }),
      refusalOf(struck, {
        ...assign,
        overrides: [{ key: 'judging.strike', reason: 'Only judge free' }],
      }),
    ],
    expected: [
      'panel-full',
      'judge-on-panel',
      'not-found',
      'judge-unavailable',
      'judge-unavailable',
      'judge-double-booked',
      'rule-broken',
      'rule-broken',
      'reason-required',
      'accepted',
    ],
  });
  const sameSchool = withJudge({ schoolOrganizationId: id('s') });
  const outcome = decideFixture(sameSchool, assign);
  assert({
    given: 'a broken rule whose force is a preference',
    should: 'accept and report it',
    actual: outcome.kind === 'accepted' ? outcome.findings : outcome,
    expected: [
      { kind: 'preference', key: 'judging.same_school', detail: id('k') },
    ],
  });
  const chaired = decideFixture(base, { ...assign, chair: true });
  assert({
    given: 'a new chair',
    should: 'take the chair from the judge who held it',
    actual: chaired.kind === 'accepted' ? chaired.writes[0] : chaired,
    expected: {
      table: 'fixture_judges',
      op: 'update',
      fixtureId,
      tournamentJudgeId: id('j'),
      set: { chair: false },
    },
  });
});

test('replace and unassign', () => {
  const replaced = decideFixture(base, replace);
  assert({
    given: 'replace-judge',
    should: 'remove the judge and seat the new one in their chair, in one step',
    actual:
      replaced.kind === 'accepted' ? replaced.writes.slice(0, 2) : replaced,
    expected: [
      {
        table: 'fixture_judges',
        op: 'delete',
        fixtureId,
        tournamentJudgeId: id('j'),
      },
      {
        table: 'fixture_judges',
        op: 'insert',
        row: {
          fixtureId,
          tabRoundId: id('t'),
          eventId: id('v'),
          lobbyId: id('l'),
          fixtureStatus: 'published',
          tournamentJudgeId: id('k'),
          chair: true,
        },
      },
    ],
  });
  assert({
    given: 'a replacement whose people changed',
    should: 'tell the people seated before and after',
    actual:
      replaced.kind === 'accepted'
        ? replaced.fixtureChanges[0]?.people
        : replaced,
    expected: [id('1'), id('2'), id('3'), id('4')],
  });
  assert({
    given: 'unassigning a judge not on the panel',
    should: 'refuse judge-not-on-panel',
    actual: refusalOf(base, { ...unassign, judgeId: id('k') }),
    expected: 'judge-not-on-panel',
  });

  // j has submitted; k has not. Removing k leaves a complete panel.
  const waiting: FixtureFacts = {
    ...inState.ballot_in,
    panel: [...base.panel, { tournamentJudgeId: id('k'), chair: false }],
  };
  const completing = decideFixture(waiting, { ...unassign, judgeId: id('k') });
  const resultRows =
    completing.kind === 'accepted'
      ? completing.writes.filter((write) => write.table === 'results')
      : [];
  assert({
    given: 'an unassignment after which every judge left has submitted',
    should: 'decide the result: exactly one decided result row on the Round',
    actual: resultRows.map((write) =>
      write.table === 'results'
        ? [write.row.kind, write.row.roundId, write.row.id]
        : null,
    ),
    expected: [['decided', id('d'), id('r')]],
  });
  assert({
    given: 'that decided result',
    should: 'give each entry the ballots naming its side',
    actual:
      completing.kind === 'accepted'
        ? completing.writes.flatMap((write) =>
            write.table === 'result_entries'
              ? [[write.row.entryId, write.row.won, write.row.ballotsWon]]
              : [],
          )
        : completing,
    expected: [
      [id('a'), true, 1],
      [id('b'), false, 0],
    ],
  });
});

test('restart and forfeit', () => {
  assert({
    given: 'a restart in each state',
    should: 'need a published fixture with a started Round and no result',
    actual: (Object.keys(inState) as FixtureState[]).map((state) =>
      refusalOf(inState[state], restart),
    ),
    expected: [
      'fixture-unpublished',
      'round-not-started',
      'accepted',
      'accepted',
      'result-exists',
      'fixture-withdrawn',
    ],
  });
  assert({
    given: 'a restart with a blank reason',
    should: 'refuse reason-required',
    actual: refusalOf(inState.round_started, { ...restart, reason: ' ' }),
    expected: 'reason-required',
  });
  const restarted = decideFixture(inState.round_started, restart);
  assert({
    given: 'an accepted restart',
    should:
      'void the Round, open a new Room like the old one and point the fixture at it',
    actual: restarted.kind === 'accepted' ? restarted.writes : restarted,
    expected: [
      {
        table: 'rounds',
        op: 'update',
        id: id('d'),
        set: { status: 'abandoned' },
      },
      { table: 'rooms', op: 'insert', id: id('m'), likeRoomId: id('o') },
      {
        table: 'fixtures',
        op: 'update',
        id: fixtureId,
        set: { version: 5, roomId: id('m') },
      },
    ],
  });

  assert({
    given: 'a forfeit in each state',
    should: 'be an administrative result only until there is a result',
    actual: (Object.keys(inState) as FixtureState[]).map((state) =>
      refusalOf(inState[state], forfeit),
    ),
    expected: [
      'fixture-unpublished',
      'accepted',
      'accepted',
      'accepted',
      'result-exists',
      'fixture-withdrawn',
    ],
  });
  assert({
    given:
      'a forfeit by an entry that is not in the fixture, or without a reason',
    should: 'refuse it by name',
    actual: [
      refusalOf(base, { ...forfeit, entryId: id('z') }),
      refusalOf(base, { ...forfeit, reason: '' }),
    ],
    expected: ['entry-not-in-fixture', 'reason-required'],
  });
  const forfeited = decideFixture(inState.round_started, forfeit);
  assert({
    given: 'an accepted forfeit',
    should:
      'write exactly one administrative result row, with the forfeiting entry losing',
    actual:
      forfeited.kind === 'accepted'
        ? forfeited.writes.flatMap((write) => {
            if (write.table === 'results')
              return [
                [
                  write.row.kind,
                  write.row.administrativeReason,
                  write.row.commandId,
                ],
              ];
            if (write.table === 'result_entries')
              return [[write.row.entryId, write.row.won]];
            return [];
          })
        : forfeited,
    expected: [
      ['administrative', 'forfeit', id('c')],
      [id('a'), true],
      [id('b'), false],
    ],
  });
  assert({
    given: 'a command naming another fixture',
    should: 'answer not-found',
    actual: refusalOf(base, { ...forfeit, fixtureId: id('g') }),
    expected: 'not-found',
  });
});
