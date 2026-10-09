import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { RoomAssemblyState } from '@daisy/protocol';
import { executeRoomCommand, projectRoom } from './room-assembly';

setupRitewayBun();
const rules = {
  version: 2 as const,
  seats: { affirmative: 1, negative: 1, judge: 0 },
  segments: [],
  inRoundPrep: null,
  countdownMs: 0,
  interaction: {
    crossExMode: 'ordered' as const,
    yield: null,
    interruptions: null,
  },
};
const state = (): RoomAssemblyState => ({
  id: 'room',
  version: 4,
  changeVersion: 1,
  title: 'Room',
  topic: 'Motion',
  visibility: 'public',
  hostActorId: 'host',
  hostLabel: 'Host',
  status: 'ready',
  formatId: 'format',
  formatVersion: 1,
  presetVersion: null,
  competitionType: 'casual',
  length: 'full',
  definition: {
    version: 1,
    seats: rules.seats,
    segments: [],
    configurable: {
      preRoundPrep: null,
      inRoundPrep: null,
      timing: { countdownMs: { min: 0, max: 0 }, segmentDurationMs: {} },
      interaction: {
        crossExModes: ['ordered'],
        interruptions: null,
        yield: null,
      },
    },
  },
  config: {
    preRoundPrep: { enabled: false },
    inRoundPrep: { enabled: false },
    speechTiming: { countdownMs: 0, segmentDurationOverrides: {} },
    crossExamination: { crossExMode: 'ordered' },
    interruptions: null,
    yielding: null,
  },
  executionPlan: { preRoundPrep: { enabled: false } },
  rules,
  participants: [
    {
      id: 'p1',
      actorId: 'host',
      label: 'Host',
      kind: 'human',
      role: 'affirmative',
      slot: 0,
      eligible: true,
      consentVersion: 0,
      consentCommandId: 'r1',
    },
    {
      id: 'p2',
      actorId: 'other',
      label: 'Other',
      kind: 'human',
      role: 'negative',
      slot: 0,
      eligible: true,
      consentVersion: 0,
      consentCommandId: 'r2',
    },
  ],
  prepStartedAt: null,
  prepRemainingMs: null,
  roundRef: null,
});
const edges = {
  now: '2026-10-09T00:00:00.000Z',
  participantId: 'new-seat',
  formatId: 'new-format',
  target: null,
};
const consent = { available: true, readyActorIds: ['host', 'other'] };

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
    const view = projectRoom(room, 'host', consent, edges.now);
    assert({
      given: 'complete cast and current consent',
      should:
        'allow atomic freeze while keeping the prelaunch view server-owned',
      actual: [
        result.ok && result.mutation.freeze,
        view.capabilities.canStart,
        view.roundRef,
        view.participants.map((p) => [p.needsReady, p.ready]),
      ],
      expected: [
        true,
        true,
        null,
        [
          [true, 'ready'],
          [true, 'ready'],
        ],
      ],
    });
  });
});
