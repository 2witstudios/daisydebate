import { assert, setupRitewayBun, test } from 'riteway/bun';
import { executeRoomCommand, projectRoom } from './room-assembly';
import { state, consent, edges } from './room-assembly.test-support';
import { command } from './round-opening.test-support';
setupRitewayBun();

const start = (room = state(), ready = consent) =>
  executeRoomCommand(
    room,
    'host',
    command('start-round', {}, room),
    ready,
    edges,
  );

test('Start round is the one commitment of readiness', () => {
  const absent = { available: true, readyActorIds: [] };
  assert({
    given: 'a cast that is not Ready',
    should: 'refuse Start round',
    actual: start(state(), absent),
    expected: { ok: false, refusal: 'not-ready' },
  });
  const ineligible = state();
  assert({
    given: 'an ineligible cast with everyone Ready',
    should: 'refuse Start round',
    actual: start({
      ...ineligible,
      participants: ineligible.participants.map((p) => ({
        ...p,
        eligible: false,
      })),
    }),
    expected: { ok: false, refusal: 'actor-ineligible' },
  });
});

test('a started Room takes no further Ready, edit or close', () => {
  const started = start();
  if (!started.ok) throw new Error(started.refusal);
  const room = started.mutation.state;
  assert({
    given: 'Ready, Not ready and Close after Start round, from stale tabs',
    should: 'refuse each without a mutation',
    actual: [
      ...(['ready', 'unready'] as const).map((type) =>
        executeRoomCommand(
          room,
          'host',
          command(type, { expectedConsentVersion: 0 }, room),
          consent,
          edges,
        ),
      ),
      executeRoomCommand(
        room,
        'host',
        command('close', {}, room),
        consent,
        edges,
      ),
    ],
    expected: [
      { ok: false, refusal: 'room-closed' },
      { ok: false, refusal: 'room-closed' },
      { ok: false, refusal: 'room-closed' },
    ],
  });
  assert({
    given: 'the started Room',
    should: 'offer no readiness or start capability',
    actual: [
      projectRoom(room, 'host', consent, '2026-11-02T12:00:00.000Z')
        .capabilities.canReady,
      projectRoom(room, 'host', consent, '2026-11-02T12:00:00.000Z')
        .capabilities.canStart,
    ],
    expected: [false, false],
  });
});
