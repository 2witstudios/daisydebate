import { daisyOrganizationId, publicLobbyId } from './daisy-reference';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { AppError } from '@daisy/errors';
import { assertRejects } from '@daisy/errors/testing';
import type { FormatSelectionFacts } from '@daisy/protocol';
import { foundationDefinition, oneOnOneSettings } from './reference-formats';
import {
  accountRow,
  caller,
  room,
} from './room-command-operations.test-support';
import { createTestDatabase, roomRow, validRules } from './index.test-support';

setupRitewayBun();

test('Room create command writes its receipt and exactly one change event', async () => {
  const account = accountRow();
  const { database, queries } = createTestDatabase([
    [],
    [account],
    [account],
    [],
    [],
    [],
    // The creator's competition age, club staff under subject scope, then the official lobbies.
    [],
    [],
    [],
    [],
    [],
    [[publicLobbyId, 'Open', 'open', 'adults', daisyOrganizationId]],
    [{ now: new Date('2026-10-09T00:00:00.000Z') }],
    [], // public lobby has no league ladder selection
    [],
    [],
    [],
    [[room.id]],
    [],
    [[1n, '42']],
    [],
  ]);

  const receipt = await database.createRoomCommand({
    room,
    lobbyChoice: null,
    membersOf: () => [room.hostActorId],
    commandId: 'c4a2b6d8f1h3j5k7m9n2p4r6',
    payloadDigest: 'a'.repeat(64),
    definition: foundationDefinition,
    caller,
    authorize: (fact) => fact?.member === true && fact.erased === false,
  });
  const roomWrite = queries.find(({ query }) =>
    /insert into "rooms"/i.test(query),
  );

  assert({
    given: 'an authorized casual host with no age record and no active Room',
    should:
      'use the eligible adults lobby and persist the receipt with one change event',
    actual: [
      receipt,
      queries.filter(({ query }) => query.includes('pg_notify')).length,
      roomWrite?.params.includes(publicLobbyId),
      roomWrite?.query.includes('"division"'),
    ],
    expected: [
      {
        commandId: 'c4a2b6d8f1h3j5k7m9n2p4r6',
        roomId: room.id,
        resultingVersion: 1,
        roundRef: null,
        replayed: false,
      },
      1,
      true,
      false,
    ],
  });
});

test('Room create rechecks its catalog selection under the create transaction (PR #472 review)', async () => {
  const account = accountRow();
  // Positional columns, as readFormatSelectionFacts selects them.
  const factsRow = [
    'freestyle',
    'Freestyle',
    [],
    null,
    'standard',
    2,
    foundationDefinition,
    3,
    1,
    oneOnOneSettings,
    false,
    new Date(0),
  ];
  const { database, queries } = createTestDatabase([
    [],
    [account],
    [account],
    [],
    [factsRow],
  ]);
  const judged: (FormatSelectionFacts | null)[] = [];
  await assertRejects({
    given:
      'a publication that moved the format on between the decision and the write',
    should: 'refuse the create as format-unavailable',
    actual: () =>
      database.createRoomCommand({
        room,
        lobbyChoice: null,
        membersOf: () => [room.hostActorId],
        commandId: 'c4a2b6d8f1h3j5k7m9n2p4r6',
        payloadDigest: 'a'.repeat(64),
        definition: null,
        selection: {
          tuple: { formatId: 'freestyle', formatVersion: 1, presetVersion: 3 },
          admits: (facts) => {
            judged.push(facts);
            return false;
          },
        },
        caller,
        authorize: (fact) => fact?.member === true && fact.erased === false,
      }),
    code: 'CONFLICT',
  });
  assert({
    given: 'the refused recheck',
    should:
      'judge the facts read for share inside the transaction and write no Room',
    actual: {
      judged: judged.map((facts) => facts?.format.currentVersion),
      forShare: queries.some(({ query }) => /for share/i.test(query)),
      roomWritten: queries.some(({ query }) =>
        /insert into "rooms"/i.test(query),
      ),
    },
    expected: { judged: [2], forShare: true, roomWritten: false },
  });
});

const secondActorId = 'c2a4e6f8h1j3k5m7n9p2r4t6';
const readyRoom = { ...room, rules: validRules };
const roundId = 'c3a1d5f7h9j2k4m6n8p1r3t5';
/** A start-round whose policy accepts whatever Room it is handed. */
const startInput: Parameters<
  ReturnType<typeof createTestDatabase>['database']['executeRoomCommand']
>[0] = {
  caller,
  seatsBotDebater: () => false,
  authorizeRead: (candidate, fact) =>
    fact?.member === true && candidate.hostActorId === caller.actorId,
  roomId: readyRoom.id,
  actorId: caller.actorId,
  commandId: 'c7a5d3f1h9j2k4m6n8p1r3t5',
  payloadDigest: 'b'.repeat(64),
  type: 'start-round',
  targetActorId: null,
  formatTuple: null,
  roundId,
  readyAgreements: () => null,
  prepare: async () => (state) => ({
    ok: true,
    mutation: {
      state: {
        ...state,
        status: 'started',
        roundRef: { id: roundId, status: 'active' },
        version: state.version + 1,
        changeVersion: state.changeVersion + 1,
      },
      consent: null,
      freeze: true,
      seatsBotDebater: false,
      publishDefinition: false,
      draw: null,
      seatDraw: null,
      roundSeed: null,
      members: [caller.actorId],
    },
  }),
};

/** The start test's rows, in query order, with the Room at `changeVersion`. */
const startRows = (changeVersion = 1) => [
  [[caller.actorId], [secondActorId]],
  [accountRow(), accountRow(secondActorId, 'c4a2b6d8f1h3j5k7m9n2p4r6', 2)],
  [accountRow()],
  [],
  [
    roomRow({
      id: readyRoom.id,
      hostActorId: caller.actorId,
      title: readyRoom.title,
      topic: readyRoom.topic,
      visibility: readyRoom.visibility,
      formatId: readyRoom.formatId,
      config: readyRoom.config,
      capture: null,
      postRoundCall: false,
      executionPlan: readyRoom.executionPlan,
      rulesSnapshot: readyRoom.rules,
      status: 'ready',
      changeVersion,
    }),
  ],
  [[foundationDefinition]],
  [
    [
      'c5a1b3d7e9f2h4j6k8m1n3p5',
      readyRoom.id,
      caller.actorId,
      'side',
      'affirmative',
      0,
      'r1',
      0,
    ],
    [
      'c6a4e2f8h1j3k5m7n9p2r4t6',
      readyRoom.id,
      secondActorId,
      'side',
      'negative',
      0,
      'r2',
      0,
    ],
  ],
  [['adults']], // the Room’s age rule
  [[caller.actorId, 'human', 'Host', null, true, null]],
  [[secondActorId, 'human', 'Other', null, true, null]],
  [[caller.actorId, 'human', 'Host', null, true, null]],
  [],
  [],
  [{ now: new Date('2026-10-09T00:00:00.000Z') }],
  [], // the caller's entitlement grants, read under the account fence
  [],
  [], // a started Room's friend challenges are deleted (ISSUE-699)
  [], // no invitation has lapsed (ADR 0124)
  [], // no invitation is pending to settle (ADR 0124)
  [],
  [],
  [],
  [],
  [[readyRoom.id]], // the host's active membership is this Room's
  [
    { id: caller.actorId, ageBand: null },
    { id: secondActorId, ageBand: null },
  ], // the seated debaters still fit the Room's lobby
  [[null]], // the source Room has no league ladder selection to freeze
  [],
  [],
  [[2n, '42']], // Round phase signal for the frozen Round
  [], // the live Round loops' work wake (ADR 0154)
  [],
  [], // the seated members its start tells: none in this fake (ADR 0144)
  [], // command receipt insert follows the Round phase signal
  [[1n, '42']],
  [],
];

/** One attempt up to the Room lock: prepared at one change version, locked at another. */
const attemptRows = (prepared: number, locked: number) => {
  const before = startRows(prepared);
  const after = startRows(locked);
  return [
    [],
    [accountRow()],
    ...before.slice(4, 12),
    [], // no seat holds
    before[13]!, // fresh authorization instant before preparation's receipt read
    [],
    before[13]!,
    ...after.slice(0, 3),
    ...after.slice(4, 12),
    [], // no seat holds
    after[13]!, // final authorization is sampled after account and Room fences
  ];
};
/** A whole accepted start at `changeVersion`, through its receipt. */
const successRows = (changeVersion = 1) => [
  ...attemptRows(changeVersion, changeVersion),
  startRows(changeVersion)[14]!, // grants precede the mutation's authority clock
  startRows(changeVersion)[13]!,
  [[readyRoom.id, publicLobbyId, null, null, daisyOrganizationId, null]], // exact locked Room ballot-source lookup, genuinely unpinned
  ...startRows(changeVersion).slice(15),
];

test('Start mutation commits one frozen Round, cast, receipt, and change signal', async () => {
  const { database, queries } = createTestDatabase(successRows());

  const receipt = await database.executeRoomCommand(startInput);

  assert({
    given: 'a complete current cast accepted by the Room policy',
    should: 'freeze the stored Round and cast with one accepted change receipt',
    actual: [
      receipt,
      queries.filter(({ query }) => query.includes('insert into "rounds"'))
        .length,
      queries.filter(({ query }) =>
        query.includes('insert into "round_participants"'),
      ).length,
      queries
        .filter(({ query }) => query.startsWith('insert into "outbox"'))
        .map(({ params }) =>
          params.find((value) => typeof value === 'object' && value !== null),
        ),
      queries.filter(({ query }) => query.includes("pg_notify('outbox'"))
        .length,
    ],
    expected: [
      {
        commandId: 'c7a5d3f1h9j2k4m6n8p1r3t5',
        roomId: readyRoom.id,
        resultingVersion: 2,
        roundRef: { id: roundId, status: 'active' },
        replayed: false,
      },
      1,
      1,
      [
        {
          kind: 'round.phase-changed',
          ids: [roundId],
          entityVersion: 1,
        },
        {
          kind: 'room.changed',
          ids: [readyRoom.id],
          entityVersion: 2,
        },
      ],
      2,
    ],
  });
});

test('a Room that moves under a command retries from fresh facts, then refuses as changed', async () => {
  // Prepared at change version 1, locked at 2 every time: each attempt is stale.
  const stale = attemptRows(1, 2);
  const { database, queries } = createTestDatabase([
    ...stale,
    ...stale,
    ...stale,
    ...stale,
    ...stale,
    ...stale,
  ]);

  await assertRejects({
    given: 'a Room whose change version moves before every lock',
    should: 'refuse as a conflict',
    actual: () => database.executeRoomCommand(startInput),
    code: 'CONFLICT',
  });
  const refusal = await database
    .executeRoomCommand(startInput)
    .catch((error: AppError) => error.reason);
  assert({
    given: 'three stale attempts, twice',
    should:
      'prepare three times each, write nothing, and refuse in the words the page has',
    actual: [
      queries.filter(({ query }) => query.includes('for update')).length,
      queries.filter(({ query }) => query.startsWith('insert')).length,
      refusal,
    ],
    expected: [6, 0, 'version-conflict'],
  });
});

test('a command that meets one stale attempt succeeds on fresh facts (PR #472 race)', async () => {
  const { database, queries } = createTestDatabase([
    ...attemptRows(1, 2),
    ...successRows(2),
  ]);

  const receipt = await database.executeRoomCommand(startInput);

  assert({
    given: 'maintenance moving the Room once between preparation and the lock',
    should:
      'prepare twice, then write the Round exactly once and return the receipt',
    actual: [
      queries.filter(({ query }) => query.includes('for update')).length,
      queries.filter(({ query }) => query.includes('insert into "rounds"'))
        .length,
      receipt.replayed,
      receipt.roundRef,
    ],
    expected: [2, 1, false, { id: roundId, status: 'active' }],
  });
});
