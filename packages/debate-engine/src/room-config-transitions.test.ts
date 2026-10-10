import { assert, setupRitewayBun, test } from 'riteway/bun';
import { executeRoomCommand } from './room-assembly';
import { consent, edges, state } from './room-assembly.test-support';

setupRitewayBun();

test('host details and legal timing edits advance version and clear consent', () => {
  const room = state();
  const details = executeRoomCommand(
    room,
    'host',
    {
      type: 'update-details',
      commandId: 'details',
      expectedVersion: room.version,
      title: 'New title',
      topic: 'New motion',
      visibility: 'unlisted',
    },
    consent,
    edges,
  );
  const config = {
    ...room.config,
    speechTiming: {
      countdownMs: 0,
      segmentDurationOverrides: { A1: 60_000 },
    },
  };
  const timing = executeRoomCommand(
    room,
    'host',
    {
      type: 'update-config',
      commandId: 'config',
      expectedVersion: room.version,
      config,
    },
    consent,
    edges,
  );
  assert({
    given: 'host-authorized details and a compiler-legal segment override',
    should: 'persist the edits, advance version and invalidate readiness',
    actual: [
      details.ok && [
        details.mutation.state.title,
        details.mutation.state.topic,
        details.mutation.state.visibility,
        details.mutation.state.version,
        details.mutation.state.participants.map((p) => p.consentCommandId),
      ],
      timing.ok && [
        timing.mutation.state.config,
        timing.mutation.state.version,
        timing.mutation.state.participants.map((p) => p.consentCommandId),
        timing.mutation.publishDefinition,
      ],
    ],
    expected: [
      ['New title', 'New motion', 'unlisted', 5, [null, null]],
      [config, 5, [null, null], false],
    ],
  });
});

test('format publication updates the pinned definition and admits an eligible bot', () => {
  const room = state();
  const format = executeRoomCommand(
    room,
    'host',
    {
      type: 'update-format',
      commandId: 'format',
      expectedVersion: room.version,
      definition: room.definition,
      config: room.config,
    },
    consent,
    { ...edges, formatId: 'published-format' },
  );
  const expanded = {
    ...room,
    rules: { ...room.rules, seats: { ...room.rules.seats, judge: 1 } },
    definition: {
      ...room.definition,
      seats: { ...room.definition.seats, judge: 1 },
    },
  };
  const bot = {
    id: 'bot-source',
    actorId: 'judge-bot',
    label: 'Practice judge',
    kind: 'bot' as const,
    role: 'judge' as const,
    slot: 0,
    eligible: true,
    consentVersion: 0,
  };
  const assigned = executeRoomCommand(
    expanded,
    'host',
    {
      type: 'assign-seat',
      commandId: 'assign-bot',
      expectedVersion: room.version,
      actorId: bot.actorId,
      role: 'judge',
      slot: 0,
    },
    consent,
    { ...edges, target: bot },
  );
  assert({
    given: 'a newer format definition and eligible bot catalog row',
    should: 'publish once and assign the real catalog target',
    actual: [
      format.ok && [
        format.mutation.state.formatId,
        format.mutation.state.formatVersion,
        format.mutation.publishDefinition,
      ],
      assigned.ok && assigned.mutation.state.participants.at(-1),
    ],
    expected: [
      ['published-format', 1, true],
      { ...bot, id: edges.participantId, consentCommandId: null },
    ],
  });
});
