import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { RoomAssemblyState, RoomCommand } from '@daisy/protocol';
import { executeRoomCommand } from './room-assembly';
import { consent, edges, state } from './room-assembly.test-support';

setupRitewayBun();

const setVisibility = (
  room: RoomAssemblyState,
  actor: string,
  visibility: 'public' | 'unlisted',
) =>
  executeRoomCommand(
    room,
    actor,
    {
      type: 'set-visibility',
      commandId: 'cmd',
      expectedVersion: room.version,
      visibility,
    } as RoomCommand,
    consent,
    edges,
  );

test('set-visibility (ADR 0143, D9)', () => {
  const room = state();
  const unlisted = setVisibility(room, room.hostActorId, 'unlisted');
  assert({
    given: 'the host making a casual Room unlisted, a guest trying, and a ranked Room',
    should:
      'change who can join and nothing else, for the host only, and keep a ranked Room public',
    actual: {
      changed:
        unlisted.ok &&
        unlisted.mutation.state.visibility === 'unlisted' &&
        unlisted.mutation.state.title === room.title &&
        unlisted.mutation.state.topic === room.topic,
      guest: setVisibility(room, 'not-the-host', 'unlisted'),
      ranked: setVisibility(
        { ...room, competitionType: 'ranked' },
        room.hostActorId,
        'unlisted',
      ),
    },
    expected: {
      changed: true,
      guest: { ok: false, refusal: 'host-required' },
      ranked: { ok: false, refusal: 'illegal-config' },
    },
  });
});
