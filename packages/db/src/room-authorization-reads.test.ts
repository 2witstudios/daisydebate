import { assert, setupRitewayBun, test } from 'riteway/bun';
import { foundationDefinition } from './reference-formats';
import {
  caller,
  accountFact,
  room,
} from './room-command-operations.test-support';
import {
  createTestDatabase,
  roomRow,
  roundRow,
  validRules,
} from './index.test-support';

setupRitewayBun();

test('Room assembly read hydrates its pinned definition and current host label', async () => {
  const account = accountFact();
  const { database } = createTestDatabase([
    [account],
    [account],
    [
      roomRow({
        id: room.id,
        hostActorId: caller.actorId,
        title: room.title,
        topic: room.topic,
        formatId: room.formatId,
        config: room.config,
        executionPlan: room.executionPlan,
        rulesSnapshot: room.rules,
      }),
    ],
    [[foundationDefinition]],
    [], // the Room has no claimed participants yet
    [[caller.actorId, 'human', 'current-host', null, true, null]],
    [], // no scheduled Round exists
  ]);

  const state = await database.readRoomAssembly(
    room.id,
    caller,
    (candidate, fact) =>
      fact?.member === true && candidate.hostActorId === caller.actorId,
  );

  assert({
    given:
      'a public assembly with its account fence and pinned format revision',
    should: 'return current identity facts with frozen Room rules',
    actual: [state.hostLabel, state.rules, state.participants, state.roundRef],
    expected: ['current-host', validRules, [], null],
  });
});
test('Room authority projection keeps collection fields minimal and omits an empty join', async () => {
  const { database } = createTestDatabase([
    [accountFact()],
    [accountFact()],
    [
      [
        room.id,
        caller.actorId,
        'private',
        'ready',
        7,
        caller.actorId,
        'affirmative',
        0,
      ],
      [room.id, caller.actorId, 'private', 'ready', 7, null, null, null],
    ],
  ]);

  const facts = await database.readRoomAuthorizationFacts(room.id, caller);

  assert({
    given: 'a private Room with one seat and a null left-join row',
    should: 'return only authorized resource facts and omit the empty join',
    actual: facts,
    expected: {
      account: accountFact(),
      resource: {
        kind: 'room',
        roomId: room.id,
        hostActorId: caller.actorId,
        visibility: 'private',
        status: 'ready',
        revision: 7,
        participants: [
          { actorId: caller.actorId, role: 'affirmative', slot: 0 },
        ],
      },
    },
  });
});
test('Round authority projection returns only frozen audience and seat facts', async () => {
  const roundId = 'c3a1d5f7h9j2k4m6n8p1r3t5';
  const { database, queries } = createTestDatabase([
    [accountFact()],
    [accountFact()],
    [
      [
        roundId,
        caller.actorId,
        'private',
        'scheduled',
        4,
        caller.actorId,
        'affirmative',
        0,
      ],
      [roundId, caller.actorId, 'private', 'scheduled', 4, null, null, null],
    ],
  ]);

  const facts = await database.readRoundAuthorizationFacts(roundId, caller);

  assert({
    given: 'a private scheduled Round with a participant and an empty join row',
    should: 'return the account-fenced audience facts without Round content',
    actual: facts,
    expected: {
      account: accountFact(),
      resource: {
        kind: 'round',
        roundId,
        createdByActorId: caller.actorId,
        visibility: 'private',
        status: 'scheduled',
        revision: 4,
        participants: [
          { actorId: caller.actorId, role: 'affirmative', slot: 0 },
        ],
      },
    },
  });
  assert({
    given: 'the authorization fact query for a Round topic',
    should:
      'avoid selecting title, resolution, rules, or configuration content',
    actual: [
      queries[2]?.query.includes('"title"'),
      queries[2]?.query.includes('"resolution"'),
      queries[2]?.query.includes('"rules_snapshot"'),
      queries[2]?.query.includes('"room_config_snapshot"'),
    ],
    expected: [false, false, false, false],
  });
});
test('Round authority projection fails closed when persisted visibility is absent', async () => {
  const roundId = 'c3a1d5f7h9j2k4m6n8p1r3t5';
  const { database } = createTestDatabase([
    [accountFact()],
    [accountFact()],
    [[roundId, caller.actorId, null, 'scheduled', 1, null, null, null]],
  ]);

  const facts = await database.readRoundAuthorizationFacts(roundId, caller);

  assert({
    given: 'a standalone legacy Round without a persisted visibility',
    should: 'refuse to infer a public audience from identity or seats',
    actual: facts,
    expected: null,
  });
});
test('Round read returns only the stored receipt and current participant identity', async () => {
  const account = accountFact();
  const { database } = createTestDatabase([
    [account],
    [account],
    [
      roundRow({
        id: 'c3a1d5f7h9j2k4m6n8p1r3t5',
        roomId: room.id,
        createdByActorId: caller.actorId,
        visibility: 'private',
        roomConfigSnapshot: room.config,
        resolution: room.topic,
        competitionType: 'casual',
        length: 'full',
        formatId: room.formatId,
        formatVersion: 1,
        presetVersion: null,
        rules: validRules,
        status: 'scheduled',
        currentStage: null,
        outcome: null,
        ladderId: null,
        startedAt: null,
        completedAt: null,
        checkpoint: null,
        createdAt: '2026-10-09T00:00:00.000Z',
        updatedAt: '2026-10-09T00:00:00.000Z',
        version: 1,
      }),
    ],
    [
      [
        'c6d4e2f8h1j3k5m7n9p2r4t6',
        'c3a1d5f7h9j2k4m6n8p1r3t5',
        caller.actorId,
        'affirmative',
        0,
      ],
    ],
    [[caller.actorId, 'human', 'current-host', null, true, null]],
  ]);

  const view = await database.readLaunchedRound(
    'c3a1d5f7h9j2k4m6n8p1r3t5',
    caller,
    (candidate, fact) =>
      fact?.member === true &&
      candidate.hostActorId === caller.actorId &&
      candidate.status === 'scheduled',
  );

  assert({
    given:
      'a private scheduled Round, one persisted participant, and a current host account',
    should: 'return the frozen resolution and cast through the authorized read',
    actual: [
      view.topic,
      view.status,
      view.participants.map((participant) => [
        participant.actorId,
        participant.label,
        participant.role,
      ]),
    ],
    expected: [
      room.topic,
      'scheduled',
      [[caller.actorId, 'current-host', 'affirmative']],
    ],
  });
});
