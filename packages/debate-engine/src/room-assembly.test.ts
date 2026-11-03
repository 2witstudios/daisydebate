import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  executeRoomCommand,
  projectRoom,
  type RoomCommandPolicies,
} from './room-assembly';
import { consent, edges, state } from './room-assembly.test-support';

setupRitewayBun();

describe('Room assembly authority', () => {
  test('version and host refusals preserve complete state', () => {
    const room = state();
    const before = JSON.stringify(room);
    const commands = [
      { commandId: 'c', expectedVersion: 3, type: 'start-round' as const },
      { commandId: 'c', expectedVersion: 4, type: 'close' as const },
    ];
    assert({
      given: 'stale Start and nonhost Close',
      should: 'refuse without changing assembly',
      actual: [
        executeRoomCommand(room, 'host', commands[0]!, consent, edges),
        executeRoomCommand(room, 'other', commands[1]!, consent, edges),
        JSON.stringify(room),
      ],
      expected: [
        { ok: false, refusal: 'version-conflict' },
        { ok: false, refusal: 'host-required' },
        before,
      ],
    });
  });
  test('Start requires complete current consent and fails closed on Redis loss', () => {
    const command = {
      commandId: 'c',
      expectedVersion: 4,
      type: 'start-round' as const,
    };
    assert({
      given: 'missing consent and unavailable Redis',
      should: 'return authoritative start refusals',
      actual: [
        { available: true, readyActorIds: ['host'] },
        { available: false, readyActorIds: [] },
      ].map((c) => executeRoomCommand(state(), 'host', command, c, edges)),
      expected: [
        { ok: false, refusal: 'not-ready' },
        { ok: false, refusal: 'readiness-unavailable' },
      ],
    });
  });
  test('Unready replaces the replay fence without changing assembly version', () => {
    const room = state();
    const result = executeRoomCommand(
      room,
      'other',
      {
        commandId: 'unready',
        expectedVersion: 4,
        expectedConsentVersion: 0,
        type: 'unready',
      },
      consent,
      edges,
    );
    assert({
      given: 'a seated human withdrawing consent',
      should: 'replace only that consent fence and return explicit deletion',
      actual: result.ok
        ? [
            result.mutation.state.version,
            result.mutation.state.participants.map((p) => p.consentCommandId),
            result.mutation.consent,
            room.participants[1]?.consentCommandId,
          ]
        : result,
      expected: [
        4,
        ['r1', 'unready'],
        { type: 'unready', actorId: 'other', commandId: 'unready' },
        'r2',
      ],
    });
  });
  test('projection distinguishes scheduled Launch from active Round and exposes bot readiness', () => {
    const room = state();
    const result = executeRoomCommand(
      room,
      'host',
      { commandId: 'start', expectedVersion: 4, type: 'start-round' },
      consent,
      edges,
    );
    const view = projectRoom(room, 'host', consent, '2026-11-02T12:00:00.000Z');
    assert({
      given: 'complete cast and current consent',
      should:
        'allow atomic freeze while keeping the prelaunch view server-owned',
      actual: [
        result.ok && result.mutation.freeze,
        result.ok && result.mutation.spendsAiRound,
        view.capabilities.canStart,
        view.roundRef,
        view.participants.map((p) => [p.needsReady, p.ready]),
      ],
      expected: [
        true,
        false,
        true,
        null,
        [
          [true, 'ready'],
          [true, 'ready'],
        ],
      ],
    });
  });

  test('Start accepts a complete cast when occupied slots arrive out of order', () => {
    const room = state();
    const participants = [
      ...room.participants,
      {
        id: 'p3',
        actorId: 'second-affirmative',
        label: 'Second affirmative',
        kind: 'human' as const,
        role: 'affirmative' as const,
        slot: 1,
        eligible: true,
        consentVersion: 0,
        consentCommandId: 'r3',
      },
    ];
    const rules = {
      ...room.rules,
      seats: { ...room.rules.seats, affirmative: 2 },
    };
    const configured = {
      ...room,
      rules,
      participants: [participants[2]!, participants[0]!, participants[1]!],
    };
    const result = executeRoomCommand(
      configured,
      'host',
      {
        commandId: 'start-with-reordered-cast',
        expectedVersion: configured.version,
        type: 'start-round',
      },
      {
        available: true,
        readyActorIds: ['host', 'other', 'second-affirmative'],
      },
      edges,
    );

    assert({
      given:
        'a complete cast persisted in a different order from its seat slots',
      should: 'sort the occupied slots and allow the atomic Launch',
      actual: result.ok && result.mutation.freeze,
      expected: true,
    });
  });
});

test('a host close closes the room and prevents further commands', () => {
  const room = state();
  const closed = executeRoomCommand(
    room,
    'host',
    { type: 'close', commandId: 'close', expectedVersion: room.version },
    consent,
    edges,
  );
  const afterClose = closed.ok
    ? executeRoomCommand(
        closed.mutation.state,
        'host',
        {
          type: 'update-details',
          commandId: 'edit-after-close',
          expectedVersion: closed.mutation.state.version,
          title: 'Changed',
          topic: room.topic ?? undefined,
          visibility: 'public',
        },
        consent,
        edges,
      )
    : closed;
  assert({
    given: 'the host closing an open assembled Room',
    should: 'close it and refuse every later command',
    actual: [closed.ok && closed.mutation.state.status, afterClose],
    expected: ['closed', { ok: false, refusal: 'room-closed' }],
  });
});

test('a Room command states its authority and edit class', () => {
  // @ts-expect-error A command missing from the table does not compile.
  const missing: RoomCommandPolicies = {};
  assert({
    given: 'a policy table that names no commands',
    should: 'be a compile error, so nothing reaches here but an empty object',
    actual: Object.keys(missing),
    expected: [],
  });
});
