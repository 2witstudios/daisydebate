import { assert, setupRitewayBun, test } from 'riteway/bun';
import { executeRoomCommand, projectRoom } from './room-assembly';
import { state, consent, edges } from './room-assembly.test-support';
import { begin, command } from './room-pre-round.test-support';
setupRitewayBun();

const prepRoom = () => {
  const base = state();
  return {
    ...base,
    executionPlan: {
      ...base.executionPlan,
      preRoundPrep: { enabled: true as const, durationMs: 1000 },
    },
    prepRemainingMs: 1000,
  };
};

test('pre-round commitment rejects Ready and Unready without mutation', () => {
  const room = begin().state;
  assert({
    given:
      'strikes already begun and either readiness intent with current consent revision',
    should: 'refuse both without a mutation',
    actual: ['ready', 'unready'].map((type) =>
      executeRoomCommand(
        room,
        'host',
        command(
          type as 'ready' | 'unready',
          { expectedConsentVersion: 0 },
          room,
        ),
        consent,
        edges,
      ),
    ),
    expected: [
      { ok: false, refusal: 'prep-running' },
      { ok: false, refusal: 'prep-running' },
    ],
  });
  assert({
    given: 'committed strikes',
    should: 'offer no readiness capability',
    actual: projectRoom(room, 'host', consent, edges.now, null).capabilities
      .canReady,
    expected: false,
  });
});

test('prep-only start validates readiness and direct launch still requires it', () => {
  const base = state();
  const room = prepRoom();
  const absent = { available: true, readyActorIds: [] };
  assert({
    given: 'unready cast at prep start or direct launch',
    should: 'reject both before commitment',
    actual: [
      executeRoomCommand(
        room,
        'host',
        command('start-pre-round', {}, room),
        absent,
        edges,
      ),
      executeRoomCommand(
        base,
        'host',
        command('start-round', {}, base),
        absent,
        edges,
      ),
    ],
    expected: [
      { ok: false, refusal: 'not-ready' },
      { ok: false, refusal: 'not-ready' },
    ],
  });
});

test('committed prep survives expendable readiness expiry but not ineligibility', () => {
  const room = prepRoom();
  const started = executeRoomCommand(
    room,
    'host',
    command('start-pre-round', {}, room),
    consent,
    edges,
  );
  if (!started.ok) throw new Error(started.refusal);
  const committed = started.mutation.state;
  const expired = { available: false, readyActorIds: [] };
  const later = { ...edges, now: '2026-10-09T00:00:02.000Z' };
  assert({
    given: 'committed prep with lost Redis readiness',
    should: 'permit launch',
    actual: executeRoomCommand(
      committed,
      'host',
      command('start-round', {}, committed),
      expired,
      later,
    ).ok,
    expected: true,
  });
  const invalid = {
    ...committed,
    participants: committed.participants.map((p) => ({
      ...p,
      eligible: false,
    })),
  };
  assert({
    given: 'an ineligible committed cast',
    should: 'refuse launch',
    actual: executeRoomCommand(
      invalid,
      'host',
      command('start-round', {}, invalid),
      expired,
      later,
    ),
    expected: { ok: false, refusal: 'actor-ineligible' },
  });
});
