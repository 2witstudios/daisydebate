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
    seatRole: null,
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
  const displacedClaim = executeRoomCommand(
    room,
    'extra',
    {
      type: 'claim-seat',
      commandId: 'taken-seat',
      expectedVersion: room.version,
      role: 'negative',
      slot: 0,
    },
    consent,
    {
      ...edges,
      target: {
        id: 'extra',
        actorId: 'extra',
        label: 'Extra',
        kind: 'human',
        role: 'negative',
        slot: 0,
        eligible: true,
        seatRole: null,
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
        seatRole: null,
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
    given: 'a claim onto an occupied seat, an unjoined human and out-of-bounds timing',
    should: 'refuse each mutation without changing any room state',
    actual: [displacedClaim, unjoinedHuman, badConfig, JSON.stringify(room)],
    expected: [
      { ok: false, refusal: 'seat-unavailable' },
      { ok: false, refusal: 'actor-ineligible' },
      { ok: false, refusal: 'illegal-config' },
      before,
    ],
  });
});

test('a host assign replaces the occupant in one command (ADR 0121)', () => {
  const room = state();
  const wren = {
    id: 'wren',
    actorId: 'wren-bot',
    label: 'Wren',
    kind: 'bot' as const,
    role: 'negative' as const,
    slot: 0,
    eligible: true,
    seatRole: 'debater' as const,
    consentVersion: 0,
  };
  const replaced = executeRoomCommand(
    room,
    'host',
    {
      type: 'assign-seat',
      commandId: 'replace',
      expectedVersion: room.version,
      actorId: 'wren-bot',
      role: 'negative',
      slot: 0,
    },
    consent,
    { ...edges, target: wren },
  );
  assert({
    given: 'a bot debater assigned over a seated human',
    should: 'seat the bot and free the human in the same mutation',
    actual:
      replaced.ok &&
      replaced.mutation.state.participants.map((p) => [
        p.actorId,
        p.role,
        p.slot,
      ]),
    expected: [
      ['host', 'affirmative', 0],
      ['wren-bot', 'negative', 0],
    ],
  });
  const held = {
    ...room,
    seatHolds: [
      { actorId: 'alice', until: '2026-10-09T00:10:00.000Z' },
    ],
  };
  const replacedPastHold = executeRoomCommand(
    held,
    'host',
    {
      type: 'assign-seat',
      commandId: 'replace-held',
      expectedVersion: held.version,
      actorId: 'wren-bot',
      role: 'negative',
      slot: 0,
    },
    consent,
    { ...edges, target: wren },
  );
  assert({
    given: 'a replacement while free seats stay held for an absent member',
    should: 'still replace, because a seat taken is not a seat held (ADR 0103)',
    actual: replacedPastHold.ok,
    expected: true,
  });
});

test('one assign moves the target and displaces the target seat\'s occupant', () => {
  const room = state();
  const wide = {
    ...room,
    rules: { ...room.rules, seats: { ...room.rules.seats, negative: 2 } },
    participants: [
      ...room.participants,
      {
        id: 'p3',
        actorId: 'third',
        label: 'Third',
        kind: 'human' as const,
        role: 'negative' as const,
        slot: 1,
        eligible: true,
        consentVersion: 0,
        consentCommandId: null,
      },
    ],
  };
  const other = wide.participants.find((p) => p.actorId === 'other');
  const moved = executeRoomCommand(
    wide,
    'host',
    {
      type: 'assign-seat',
      commandId: 'move',
      expectedVersion: wide.version,
      actorId: 'other',
      role: 'negative',
      slot: 1,
    },
    consent,
    { ...edges, target: { ...other!, id: 'p2' } },
  );
  assert({
    given: 'a seated member assigned to a seat another member holds',
    should: 'move the member and free both their old seat and the occupant',
    actual:
      moved.ok &&
      moved.mutation.state.participants.map((p) => [p.actorId, p.slot]),
    expected: [
      ['host', 0],
      ['other', 1],
    ],
  });
});

test('replacing a judge follows the naming rule (DEC-331, ADR 0121)', () => {
  const seatedJudge = {
    id: 'judge-seat',
    actorId: 'judge-human',
    label: 'Judge',
    kind: 'human' as const,
    role: 'judge' as const,
    slot: 0,
    eligible: true,
    consentVersion: 0,
    consentCommandId: null,
  };
  const withJudge = {
    ...state(),
    rules: { ...state().rules, seats: { ...state().rules.seats, judge: 1 } },
    participants: [...state().participants, seatedJudge],
  };
  const panel = {
    id: 'panel',
    actorId: 'panel-bot',
    label: 'The Panel',
    kind: 'bot' as const,
    role: 'judge' as const,
    slot: 0,
    eligible: true,
    seatRole: 'judge' as const,
    consentVersion: 0,
  };
  const assign = (room: typeof withJudge) =>
    executeRoomCommand(
      room,
      'host',
      {
        type: 'assign-seat',
        commandId: 'replace-judge',
        expectedVersion: room.version,
        actorId: 'panel-bot',
        role: 'judge',
        slot: 0,
      },
      consent,
      { ...edges, target: panel },
    );
  assert({
    given: 'a host who may not name judges replacing a seated human judge',
    should: 'refuse the replacement without changing the room',
    actual: assign({ ...withJudge }),
    expected: { ok: false, refusal: 'seat-unavailable' },
  });
  const seatlessHost = { ...withJudge, participants: withJudge.participants.filter((p) => p.actorId !== 'host') };
  const replaced = assign(seatlessHost);
  assert({
    given: 'a seatless host replacing the seated human judge with the AI judge',
    should: 'accept and seat the AI judge in the same mutation',
    actual:
      replaced.ok &&
      replaced.mutation.state.participants.find((p) => p.role === 'judge'),
    expected: { ...panel, id: edges.participantId, consentCommandId: null },
  });
});

test('ranked edits and format seat shrink are refused without mutation', () => {
  const base = state();
  const room = {
    ...base,
    definition: {
      ...base.definition,
      seats: { ...base.definition.seats, judge: 1 },
    },
    rules: { ...base.rules, seats: { ...base.rules.seats, judge: 1 } },
    participants: [
      ...base.participants,
      {
        ...base.participants[0]!,
        id: 'judge-seat',
        actorId: 'judge',
        role: 'judge' as const,
      },
    ],
  };
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
  const noJudgeSeats = {
    ...room.definition,
    seats: { ...room.definition.seats, judge: 0 },
  };
  const crowded = executeRoomCommand(
    room,
    'host',
    {
      type: 'update-format',
      commandId: 'shrink-format',
      expectedVersion: room.version,
      definition: noJudgeSeats,
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
      seatRole: 'judge',
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

test('a ranked Room is always public', () => {
  const room = { ...state(), competitionType: 'ranked' as const };
  const details = (visibility: 'public' | 'unlisted') =>
    executeRoomCommand(
      room,
      'host',
      {
        type: 'update-details',
        commandId: `details-${visibility}`,
        expectedVersion: room.version,
        title: 'Renamed',
        topic: room.topic!,
        visibility,
      },
      consent,
      edges,
    );
  assert({
    given: 'a ranked Room edited to unlisted',
    should: 'refuse the edit',
    actual: details('unlisted'),
    expected: { ok: false, refusal: 'illegal-config' },
  });
  assert({
    given: 'a ranked Room edited while it stays public',
    should: 'accept the edit',
    actual: details('public').ok,
    expected: true,
  });
});
