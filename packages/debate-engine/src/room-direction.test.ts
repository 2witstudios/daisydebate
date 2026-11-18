import { assert, setupRitewayBun, test } from 'riteway/bun';
import { executeRoomCommand } from './room-assembly';
import { state, edges, consent } from './room-assembly.test-support';
setupRitewayBun();

test('trusted direction names exactly one hostless Room, real actor and Start command', () => {
  const room = { ...state(), hostActorId: null, hostLabel: '' };
  const command = {
    type: 'start-round' as const,
    commandId: 'start',
    expectedVersion: room.version,
  };
  const direction = {
    roomId: room.id,
    actorId: 'official',
    command: 'start-round' as const,
    captureAdmitted: false,
  };
  const run = (overrides = direction) =>
    executeRoomCommand(room, 'official', command, consent, {
      ...edges,
      direction: overrides,
    });
  const accepted = run();
  assert({
    given: 'a ready hostless Room and an adapter-authorized official',
    should:
      'freeze its real cast and null host without granting authority to another Room, actor or command',
    actual: [
      accepted.ok && [
        accepted.mutation.freeze,
        accepted.mutation.state.hostActorId,
        accepted.mutation.state.participants,
      ],
      run({ ...direction, roomId: 'elsewhere' }),
      run({ ...direction, actorId: 'other' }),
      executeRoomCommand(
        room,
        'official',
        { ...command, type: 'close' },
        consent,
        { ...edges, direction },
      ),
      executeRoomCommand(
        { ...room, hostActorId: 'human-host' },
        'official',
        command,
        consent,
        { ...edges, direction },
      ),
    ],
    expected: [
      [true, null, room.participants],
      { ok: false, refusal: 'host-required' },
      { ok: false, refusal: 'host-required' },
      { ok: false, refusal: 'host-required' },
      { ok: false, refusal: 'host-required' },
    ],
  });
  assert({
    given: 'trusted direction without actual human Ready',
    should: 'preserve the ordinary consent fence',
    actual: executeRoomCommand(
      room,
      'official',
      command,
      { available: true, readyActorIds: [] },
      { ...edges, direction },
    ),
    expected: { ok: false, refusal: 'not-ready' },
  });
});
