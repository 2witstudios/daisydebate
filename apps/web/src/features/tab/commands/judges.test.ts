import type { JudgeCommand } from '@daisy/protocol/lobby/entry-command';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  decideJudge,
  judgeAuthorityContext,
  judgeAuthorityTarget,
  type JudgeDecision,
  type JudgeFacts,
  type TournamentJudgeFacts,
} from './judges';

setupRitewayBun();

const id = (tag: string) => tag.padEnd(24, '0');
const lobbyId = id('lobby');
const judgeId = id('judge');
const judgeActor = id('judgeactor');
const entryId = id('entry');
const eventId = id('event');
const slotA = id('slota');
const slotB = id('slotb');

const judge = (
  overrides: Partial<TournamentJudgeFacts> = {},
): TournamentJudgeFacts => ({
  id: judgeId,
  actorId: judgeActor,
  status: 'accepted',
  version: 3,
  availability: [{ timeSlotId: slotA, available: true }],
  liveFixtures: [],
  ...overrides,
});

const facts = (overrides: Partial<JudgeFacts> = {}): JudgeFacts => ({
  lobbyId,
  newJudgeId: id('newjudge'),
  sender: { actorId: id('tabdirector') },
  eventIds: [eventId],
  timeSlotIds: [slotA, slotB],
  judge: judge(),
  entry: { id: entryId, eventId, entriesVersion: 5, strikes: [] },
  ...overrides,
});

const refusalOf = (decision: JudgeDecision) =>
  decision.kind === 'refused' ? decision.refusal : 'accepted';
const writesOf = (decision: JudgeDecision) =>
  decision.kind === 'accepted' ? decision.writes : [];

const seatedIn = (timeSlotId: string) => [
  { fixtureId: id('fixture'), timeSlotId, entryIds: [entryId] },
];

describe('invite-judge and remove-judge', () => {
  const invite: JudgeCommand = {
    type: 'invite-judge',
    actorId: judgeActor,
    schoolOrganizationId: null,
    chairQualified: true,
    eventIds: [eventId],
  };

  test('an invitation makes an invited judge for the events named', () => {
    assert({
      given: 'a person not yet invited',
      should: 'insert the judge invited and its events',
      actual: writesOf(decideJudge(facts({ judge: null }), invite)),
      expected: [
        {
          table: 'tournament_judges',
          op: 'insert',
          row: {
            id: id('newjudge'),
            lobbyId,
            actorId: judgeActor,
            schoolOrganizationId: null,
            status: 'invited',
            chairQualified: true,
          },
        },
        {
          table: 'judge_events',
          op: 'insert',
          row: { tournamentJudgeId: id('newjudge'), eventId, lobbyId },
        },
      ],
    });
  });

  test('each rule refuses by name', () => {
    assert({
      given:
        'a second invitation, an unknown event, and removing a seated judge',
      should: 'name each refusal',
      actual: [
        decideJudge(facts({ judge: judge({ status: 'invited' }) }), invite),
        decideJudge(facts({ judge: null }), {
          ...invite,
          eventIds: [id('other')],
        }),
        decideJudge(
          facts({ judge: judge({ liveFixtures: seatedIn(slotA) }) }),
          {
            type: 'remove-judge',
            tournamentJudgeId: judgeId,
          },
        ),
      ].map(refusalOf),
      expected: ['already-invited', 'not-found', 'judge-assigned'],
    });
  });

  test('a declined judge may be invited again', () => {
    assert({
      given: 'a judge who declined',
      should: 'set the same row invited again',
      actual: writesOf(
        decideJudge(facts({ judge: judge({ status: 'declined' }) }), {
          ...invite,
          eventIds: undefined,
        }),
      ),
      expected: [
        {
          table: 'tournament_judges',
          op: 'update',
          where: { id: judgeId, version: 3 },
          set: {
            status: 'invited',
            schoolOrganizationId: null,
            chairQualified: true,
            version: 4,
          },
        },
        {
          table: 'judge_events',
          op: 'delete',
          where: { tournamentJudgeId: judgeId },
        },
      ],
    });
  });
});

describe('answering an invitation', () => {
  const accept: JudgeCommand = {
    type: 'accept-judge-invitation',
    tournamentJudgeId: judgeId,
  };
  const decline: JudgeCommand = {
    type: 'decline-judge-invitation',
    tournamentJudgeId: judgeId,
  };

  test('the authority context carries the answer', () => {
    assert({
      given: 'an accept, a decline and another judge command',
      should: 'give context.answer for the two answers only',
      actual: [
        accept,
        decline,
        { type: 'remove-judge', tournamentJudgeId: judgeId } as const,
      ].map(judgeAuthorityContext),
      expected: [{ answer: 'accept' }, { answer: 'decline' }, {}],
    });
  });

  test('an invited judge accepts or declines once', () => {
    const invited = facts({ judge: judge({ status: 'invited' }) });
    assert({
      given: 'an invited judge answering, and a judge already answered',
      should: 'set the answer, then refuse invitation-closed',
      actual: [
        writesOf(decideJudge(invited, accept))[0],
        writesOf(decideJudge(invited, decline))[0],
        refusalOf(decideJudge(facts(), accept)),
      ],
      expected: [
        {
          table: 'tournament_judges',
          op: 'update',
          where: { id: judgeId, version: 3 },
          set: { status: 'accepted', version: 4 },
        },
        {
          table: 'tournament_judges',
          op: 'update',
          where: { id: judgeId, version: 3 },
          set: { status: 'declined', version: 4 },
        },
        'invitation-closed',
      ],
    });
  });
});

describe('strikes and conflicts', () => {
  const strike: JudgeCommand = {
    type: 'strike-judge',
    entryId,
    tournamentJudgeId: judgeId,
  };

  test("an entry's strike is the entry's own, authorized on the entry", () => {
    assert({
      given: 'a strike and its withdrawal',
      should:
        'be authorized on the entry, where its responsible adult answers for it',
      actual: [
        judgeAuthorityTarget(strike),
        judgeAuthorityTarget({ ...strike, type: 'withdraw-strike' }),
      ],
      expected: [
        { kind: 'entry', entryId },
        { kind: 'entry', entryId },
      ],
    });
  });

  test('a strike records source entry and moves the entries version', () => {
    const decision = decideJudge(facts(), strike);
    assert({
      given: 'a strike on a judge not seated with the entry',
      should: 'insert the strike with source entry on the event aggregate',
      actual:
        decision.kind === 'accepted'
          ? {
              aggregate: decision.aggregate,
              version: decision.resultingVersion,
              first: decision.writes[0],
            }
          : decision,
      expected: {
        aggregate: { kind: 'event', id: eventId },
        version: 6,
        first: {
          table: 'judge_strikes',
          op: 'insert',
          row: {
            entryId,
            tournamentJudgeId: judgeId,
            eventId,
            lobbyId,
            source: 'entry',
          },
        },
      },
    });
  });

  test('each rule refuses by name', () => {
    const struck = facts({
      entry: {
        id: entryId,
        eventId,
        entriesVersion: 5,
        strikes: [{ tournamentJudgeId: judgeId, source: 'entry' }],
      },
    });
    const declared = facts({
      entry: {
        id: entryId,
        eventId,
        entriesVersion: 5,
        strikes: [{ tournamentJudgeId: judgeId, source: 'tab' }],
      },
    });
    assert({
      given:
        'a second strike, a seated judge, withdrawing a missing strike or a declared conflict, and a second conflict',
      should: 'name each refusal',
      actual: [
        decideJudge(struck, strike),
        decideJudge(
          facts({ judge: judge({ liveFixtures: seatedIn(slotA) }) }),
          strike,
        ),
        decideJudge(facts(), { ...strike, type: 'withdraw-strike' }),
        decideJudge(declared, { ...strike, type: 'withdraw-strike' }),
        decideJudge(struck, {
          type: 'declare-conflict',
          tournamentJudgeId: judgeId,
          entryId,
        }),
      ].map(refusalOf),
      expected: [
        'strike-exists',
        'judge-assigned',
        'strike-absent',
        'strike-absent',
        'strike-exists',
      ],
    });
  });

  test('a conflict is the judge source when they declare it, tab otherwise', () => {
    const sourceOf = (decision: JudgeDecision) => {
      const write = writesOf(decision)[0];
      return write?.table === 'judge_strikes' && write.op === 'insert'
        ? write.row.source
        : null;
    };
    const conflict: JudgeCommand = {
      type: 'declare-conflict',
      tournamentJudgeId: judgeId,
      entryId,
    };
    assert({
      given: 'a conflict declared by the judge and by tab staff',
      should: 'record judge and tab',
      actual: [
        sourceOf(
          decideJudge(facts({ sender: { actorId: judgeActor } }), conflict),
        ),
        sourceOf(decideJudge(facts(), conflict)),
      ],
      expected: ['judge', 'tab'],
    });
  });
});

describe('set-judge-availability', () => {
  test('availability is one row per judge and time slot', () => {
    assert({
      given: 'an existing slot changed and a new slot added',
      should: 'update the one, insert the other, and bump the judge',
      actual: writesOf(
        decideJudge(facts(), {
          type: 'set-judge-availability',
          tournamentJudgeId: judgeId,
          availability: [
            { timeSlotId: slotA, available: false },
            { timeSlotId: slotB, available: true },
          ],
        }),
      ),
      expected: [
        {
          table: 'judge_availability',
          op: 'update',
          where: { tournamentJudgeId: judgeId, timeSlotId: slotA },
          set: { available: false },
        },
        {
          table: 'judge_availability',
          op: 'insert',
          row: {
            tournamentJudgeId: judgeId,
            timeSlotId: slotB,
            lobbyId,
            available: true,
          },
        },
        {
          table: 'tournament_judges',
          op: 'update',
          where: { id: judgeId, version: 3 },
          set: { version: 4 },
        },
      ],
    });
  });

  test('a seated judge cannot become unavailable in that slot, nor name another lobby slot', () => {
    assert({
      given:
        'unavailability in a slot where the judge sits, and an unknown slot',
      should: 'refuse judge-assigned and not-found',
      actual: [
        decideJudge(
          facts({ judge: judge({ liveFixtures: seatedIn(slotA) }) }),
          {
            type: 'set-judge-availability',
            tournamentJudgeId: judgeId,
            availability: [{ timeSlotId: slotA, available: false }],
          },
        ),
        decideJudge(facts(), {
          type: 'set-judge-availability',
          tournamentJudgeId: judgeId,
          availability: [{ timeSlotId: id('elsewhere'), available: true }],
        }),
      ].map(refusalOf),
      expected: ['judge-assigned', 'not-found'],
    });
  });
});
