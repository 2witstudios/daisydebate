import { assert, setupRitewayBun, test } from 'riteway/bun';
import { executeRoomCommand } from './room-assembly';
import { consent, edges, state } from './room-assembly.test-support';

setupRitewayBun();

test('claim and leave operate on the caller seat while removal targets the seat id', () => {
  const room = {
    ...state(),
    rules: { ...state().rules, seats: { ...state().rules.seats, judge: 1 } },
  };
  const newJudge = {
    id: 'candidate',
    actorId: 'new-human',
    label: 'New human',
    kind: 'human' as const,
    role: 'judge' as const,
    slot: 0,
    eligible: true,
    consentVersion: 0,
    consentCommandId: null,
  };
  const claimed = executeRoomCommand(
    room,
    newJudge.actorId,
    {
      type: 'claim-seat',
      commandId: 'claim',
      expectedVersion: room.version,
      role: 'judge',
      slot: 0,
    },
    consent,
    { ...edges, target: newJudge },
  );
  const left = executeRoomCommand(
    room,
    'other',
    {
      type: 'leave-seat',
      commandId: 'leave',
      expectedVersion: room.version,
    },
    consent,
    edges,
  );
  const removed = executeRoomCommand(
    room,
    'host',
    {
      type: 'remove-seat',
      commandId: 'remove',
      expectedVersion: room.version,
      participantId: 'p2',
    },
    consent,
    edges,
  );
  assert({
    given: 'an eligible caller, self-leave and host removal by participant id',
    should: 'claim the offered seat and remove only the addressed membership',
    actual: [
      claimed.ok && claimed.mutation.state.participants.at(-1),
      left.ok && left.mutation.state.participants.map((p) => p.actorId),
      removed.ok && removed.mutation.state.participants.map((p) => p.actorId),
    ],
    expected: [{ ...newJudge, id: edges.participantId }, ['host'], ['host']],
  });
});

test('seat and configuration refusals leave the room intact', () => {
  const room = state();
  const before = JSON.stringify(room);
  const refusedSeat = executeRoomCommand(
    room,
    'host',
    {
      type: 'assign-seat',
      commandId: 'full-seat',
      expectedVersion: room.version,
      actorId: 'extra',
      role: 'affirmative',
      slot: 0,
    },
    consent,
    {
      ...edges,
      target: {
        id: 'bot',
        actorId: 'extra',
        label: 'Bot',
        kind: 'bot',
        role: 'judge',
        slot: 0,
        eligible: true,
        consentVersion: 0,
      },
    },
  );
  const unjoinedHuman = executeRoomCommand(
    room,
    'host',
    {
      type: 'assign-seat',
      commandId: 'unjoined-human',
      expectedVersion: room.version,
      actorId: 'outside-human',
      role: 'affirmative',
      slot: 0,
    },
    consent,
    {
      ...edges,
      target: {
        id: 'outside',
        actorId: 'outside-human',
        label: 'Outside',
        kind: 'human',
        role: 'affirmative',
        slot: 0,
        eligible: true,
        consentVersion: 0,
      },
    },
  );
  const badConfig = executeRoomCommand(
    room,
    'host',
    {
      type: 'update-config',
      commandId: 'bad-config',
      expectedVersion: room.version,
      config: {
        ...room.config,
        speechTiming: { countdownMs: -1, segmentDurationOverrides: {} },
      },
    },
    consent,
    edges,
  );
  assert({
    given: 'an occupied seat, an unjoined human and out-of-bounds timing',
    should: 'refuse each mutation without changing any room state',
    actual: [refusedSeat, unjoinedHuman, badConfig, JSON.stringify(room)],
    expected: [
      { ok: false, refusal: 'seat-unavailable' },
      { ok: false, refusal: 'actor-ineligible' },
      { ok: false, refusal: 'illegal-config' },
      before,
    ],
  });
});

test('ranked edits and format seat shrink are refused without mutation', () => {
  const room = state();
  const ranked = executeRoomCommand(
    { ...room, competitionType: 'ranked' },
    'host',
    {
      type: 'update-config',
      commandId: 'ranked',
      expectedVersion: room.version,
      config: room.config,
    },
    consent,
    edges,
  );
  const noAffirmativeSeats = {
    ...room.definition,
    seats: { ...room.definition.seats, affirmative: 0 },
  };
  const crowded = executeRoomCommand(
    room,
    'host',
    {
      type: 'update-format',
      commandId: 'shrink-format',
      expectedVersion: room.version,
      definition: noAffirmativeSeats,
      config: room.config,
    },
    consent,
    edges,
  );
  assert({
    given: 'a ranked room and a new format that removes occupied seats',
    should: 'refuse both host edits without changing the source room',
    actual: [ranked, crowded, JSON.stringify(room)],
    expected: [
      { ok: false, refusal: 'illegal-config' },
      { ok: false, refusal: 'seat-unavailable' },
      JSON.stringify(room),
    ],
  });
});

test('seat admission refuses missing targets, bot claims and absent memberships', () => {
  const room = state();
  const command = {
    type: 'claim-seat' as const,
    commandId: 'claim',
    expectedVersion: room.version,
    role: 'judge' as const,
    slot: 0,
  };
  const absentTarget = executeRoomCommand(
    room,
    'new-human',
    command,
    consent,
    edges,
  );
  const botClaim = executeRoomCommand(room, 'judge-bot', command, consent, {
    ...edges,
    target: {
      id: 'bot',
      actorId: 'judge-bot',
      label: 'Judge bot',
      kind: 'bot',
      role: 'judge',
      slot: 0,
      eligible: true,
      consentVersion: 0,
    },
  });
  const missingLeave = executeRoomCommand(
    room,
    'absent',
    {
      type: 'leave-seat',
      commandId: 'leave',
      expectedVersion: room.version,
    },
    consent,
    edges,
  );
  assert({
    given:
      'an absent target, an AI attempting self-claim and absent membership',
    should: 'refuse each seat transition with its specific authority reason',
    actual: [absentTarget, botClaim, missingLeave],
    expected: [
      { ok: false, refusal: 'actor-ineligible' },
      { ok: false, refusal: 'actor-ineligible' },
      { ok: false, refusal: 'not-seated' },
    ],
  });
});
