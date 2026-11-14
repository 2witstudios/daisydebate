import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { parseEach, parsedUnchanged } from '../parse-outcome.test-support';
import {
  entryCommandCatalogue,
  entryCommandEnvelopeSchema,
  entryCommandSchema,
  entryRefusals,
  judgeCommandCatalogue,
  judgeCommandSchema,
  judgeRefusals,
} from './entry-command';

setupRitewayBun();

const id = (n: number) => `e${String(n).padStart(23, '0')}`;

const entryCommands = [
  {
    type: 'submit-entry',
    eventId: id(1),
    name: 'Lincoln AB',
    memberActorIds: [id(2), id(3)],
    responsible: { kind: 'school', schoolOrganizationId: id(4) },
    division: 'Novice',
  },
  {
    type: 'submit-entry',
    eventId: id(1),
    name: 'Ada',
    memberActorIds: [id(2)],
    responsible: { kind: 'guardian', guardianLinkId: id(5) },
    division: null,
  },
  {
    type: 'submit-entry',
    eventId: id(1),
    name: 'Ada',
    memberActorIds: [id(2)],
    responsible: { kind: 'self' },
    division: null,
  },
  { type: 'accept-entry', entryId: id(6) },
  { type: 'decline-entry', entryId: id(6) },
  { type: 'withdraw-entry', entryId: id(6), reason: 'Ill' },
  {
    type: 'replace-entry-member',
    entryId: id(6),
    outActorId: id(2),
    inActorId: id(7),
  },
  { type: 'set-entry-division', entryId: id(6), division: 'Open' },
  { type: 'set-entry-division', entryId: id(6), division: null },
  { type: 'choose-break', entryId: id(6), stageId: id(8) },
] as const;

const judgeCommands = [
  {
    type: 'invite-judge',
    actorId: id(2),
    schoolOrganizationId: id(4),
    chairQualified: true,
    eventIds: [id(1)],
  },
  {
    type: 'invite-judge',
    actorId: id(2),
    schoolOrganizationId: null,
    chairQualified: false,
  },
  { type: 'remove-judge', tournamentJudgeId: id(9) },
  { type: 'accept-judge-invitation', tournamentJudgeId: id(9) },
  { type: 'decline-judge-invitation', tournamentJudgeId: id(9) },
  { type: 'strike-judge', entryId: id(6), tournamentJudgeId: id(9) },
  { type: 'withdraw-strike', entryId: id(6), tournamentJudgeId: id(9) },
  {
    type: 'set-judge-availability',
    tournamentJudgeId: id(9),
    availability: [
      { timeSlotId: id(10), available: true },
      { timeSlotId: id(11), available: false },
    ],
  },
  { type: 'declare-conflict', tournamentJudgeId: id(9), entryId: id(6) },
] as const;

describe('entry commands', () => {
  test('every valid payload parses unchanged', () => {
    assert({
      given: 'one payload per entry command and responsible-adult variant',
      should: 'parse each to itself',
      actual: parseEach(entryCommandSchema, entryCommands),
      expected: parsedUnchanged(entryCommands),
    });
  });

  test('each constraint refuses its own field', () => {
    const [school] = entryCommands;
    assert({
      given: 'payloads each breaking one constraint',
      should: 'name the field it breaks',
      actual: parseEach(entryCommandSchema, [
        { ...school, eventId: 'not-an-id' },
        { ...school, name: '  ' },
        { ...school, memberActorIds: [] },
        { ...school, memberActorIds: [id(2), id(2)] },
        { ...school, responsible: { kind: 'coach' } },
        { ...school, responsible: { kind: 'school' } },
        { ...school, division: '' },
        { type: 'withdraw-entry', entryId: id(6), reason: '' },
        {
          type: 'replace-entry-member',
          entryId: id(6),
          outActorId: id(2),
          inActorId: id(2),
        },
        { type: 'choose-break', entryId: id(6) },
        { type: 'enter-entry', entryId: id(6) },
      ]).map((outcome) => ('issues' in outcome ? outcome.issues : outcome)),
      expected: [
        ['eventId'],
        ['name'],
        ['memberActorIds'],
        ['memberActorIds'],
        ['responsible.kind'],
        ['responsible.schoolOrganizationId'],
        ['division'],
        ['reason'],
        ['inActorId'],
        ['stageId'],
        ['type'],
      ],
    });
  });

  test('an unknown key is refused', () => {
    assert({
      given: 'an accept-entry with a key the contract does not name',
      should: 'refuse it',
      actual: parseEach(entryCommandSchema, [
        { type: 'accept-entry', entryId: id(6), division: 'Open' },
      ]),
      expected: [{ issues: ['(root)'] }],
    });
  });

  test('the envelope carries the command', () => {
    const envelope = {
      version: 1,
      commandId: id(20),
      expected: { entries: 3 },
      command: entryCommands[3],
    };
    assert({
      given: 'an accept-entry in the shared envelope',
      should: 'parse unchanged',
      actual: parseEach(entryCommandEnvelopeSchema, [envelope]),
      expected: parsedUnchanged([envelope]),
    });
  });
});

describe('judge commands', () => {
  test('every valid payload parses unchanged', () => {
    assert({
      given: 'one payload per judge command',
      should: 'parse each to itself',
      actual: parseEach(judgeCommandSchema, judgeCommands),
      expected: parsedUnchanged(judgeCommands),
    });
  });

  test('each constraint refuses its own field', () => {
    assert({
      given: 'payloads each breaking one constraint',
      should: 'name the field it breaks',
      actual: parseEach(judgeCommandSchema, [
        { ...judgeCommands[0], eventIds: [] },
        { ...judgeCommands[0], eventIds: [id(1), id(1)] },
        { ...judgeCommands[0], chairQualified: 'yes' },
        { ...judgeCommands[1], schoolOrganizationId: undefined },
        {
          type: 'set-judge-availability',
          tournamentJudgeId: id(9),
          availability: [],
        },
        {
          type: 'set-judge-availability',
          tournamentJudgeId: id(9),
          availability: [
            { timeSlotId: id(10), available: true },
            { timeSlotId: id(10), available: false },
          ],
        },
        { type: 'strike-judge', entryId: id(6) },
      ]).map((outcome) => ('issues' in outcome ? outcome.issues : outcome)),
      expected: [
        ['eventIds'],
        ['eventIds'],
        ['chairQualified'],
        ['schoolOrganizationId'],
        ['availability'],
        ['availability'],
        ['tournamentJudgeId'],
      ],
    });
  });

  test('an unknown key is refused', () => {
    assert({
      given: 'a strike with a key the contract does not name',
      should: 'refuse it',
      actual: parseEach(judgeCommandSchema, [
        { ...judgeCommands[5], source: 'tab' },
      ]),
      expected: [{ issues: ['(root)'] }],
    });
  });
});

describe('entry and judge catalogues', () => {
  test('every refusal a command names is in its group list', () => {
    const outside = [
      ...Object.values(entryCommandCatalogue).flatMap((definition) =>
        definition.refusals.filter(
          (refusal) => !(entryRefusals as readonly string[]).includes(refusal),
        ),
      ),
      ...Object.values(judgeCommandCatalogue).flatMap((definition) =>
        definition.refusals.filter(
          (refusal) => !(judgeRefusals as readonly string[]).includes(refusal),
        ),
      ),
    ];
    assert({
      given: 'the entry and judge catalogues',
      should: 'name only refusals of their group lists',
      actual: outside,
      expected: [],
    });
  });

  test('every group refusal is given by some command', () => {
    const given = new Set<string>([
      ...Object.values(entryCommandCatalogue).flatMap((d) => d.refusals),
      ...Object.values(judgeCommandCatalogue).flatMap((d) => d.refusals),
    ]);
    assert({
      given: 'the group refusal lists',
      should: 'leave none unused',
      actual: [...entryRefusals, ...judgeRefusals].filter((r) => !given.has(r)),
      expected: [],
    });
  });

  test('every command catalogued names the entry and judge types exactly', () => {
    assert({
      given: 'the catalogues',
      should: 'have one definition per command type',
      actual: [
        ...Object.keys(entryCommandCatalogue),
        ...Object.keys(judgeCommandCatalogue),
      ].sort(),
      expected: [
        ...new Set([...entryCommands, ...judgeCommands].map((c) => c.type)),
      ].sort(),
    });
  });
});
