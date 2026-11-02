import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { RoomAssemblyState } from '@daisy/protocol';
import { maintainRoom } from './room-expiry';
import { state } from './room-assembly.test-support';

setupRitewayBun();

const withRound = (
  status: 'opening' | 'active' | 'completed' | 'abandoned',
): RoomAssemblyState => ({
  ...state(),
  status: 'started',
  roundRef: { id: 'round', status },
});

describe('idle expiry', () => {
  const lastCommandAt = '2026-10-09T00:00:00.000Z';
  test('a Room idle past the timeout is closed', () => {
    const room = state();
    const expired = maintainRoom(room, {
      lastCommandAt,
      now: '2026-10-09T00:10:00.000Z',
      idleTimeoutMs: 600_000,
    });
    assert({
      given: 'an open Room whose last command is exactly the timeout old',
      should: 'close it as a new change, keeping its version',
      actual: expired && [
        expired.mutation.state.status,
        expired.mutation.state.changeVersion,
        expired.mutation.state.version,
        expired.mutation.members,
      ],
      expected: ['closed', room.changeVersion + 1, room.version, []],
    });
  });

  test('recent activity, unset expiry and a started Room keep it as it is', () => {
    const now = '2026-10-09T00:10:00.000Z';
    assert({
      given: 'a recent command, no idle policy and a started Room',
      should: 'change nothing',
      actual: [
        maintainRoom(state(), {
          lastCommandAt: '2026-10-09T00:09:00.000Z',
          now,
          idleTimeoutMs: 600_000,
        }),
        maintainRoom(state(), { lastCommandAt, now, idleTimeoutMs: null }),
        maintainRoom(withRound('opening'), {
          lastCommandAt,
          now,
          idleTimeoutMs: 600_000,
        }),
      ],
      expected: [null, null, null],
    });
  });
});
