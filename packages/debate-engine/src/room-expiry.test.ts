import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { RoomAssemblyState } from '@daisy/protocol';
import { expireIdleRoom } from './room-expiry';
import { state } from './room-assembly.test-support';

setupRitewayBun();

const withRound = (
  status: 'scheduled' | 'active' | 'completed' | 'abandoned',
): RoomAssemblyState => ({
  ...state(),
  status: 'started',
  roundRef: { id: 'round', status },
});

describe('idle expiry', () => {
  const lastCommandAt = '2026-10-09T00:00:00.000Z';
  test('a Room idle past the timeout is closed', () => {
    const room = state();
    const expired = expireIdleRoom(room, {
      lastCommandAt,
      now: '2026-10-09T00:10:00.000Z',
      idleTimeoutMs: 600_000,
    });
    assert({
      given: 'an open Room whose last command is exactly the timeout old',
      should: 'abandon it as a new change, keeping its version',
      actual: expired && [
        expired.mutation.state.status,
        expired.mutation.state.changeVersion,
        expired.mutation.state.version,
        expired.mutation.members,
      ],
      expected: ['abandoned', room.changeVersion + 1, room.version, []],
    });
  });

  test('activity and running prep keep a Room open', () => {
    const now = '2026-10-09T00:10:00.000Z';
    const before = JSON.stringify(state());
    assert({
      given:
        'a Room active within the timeout, a Room still in its pre-round prep, and a closed or launched Room',
      should: 'expire none of them and leave each state unchanged',
      actual: [
        expireIdleRoom(state(), {
          lastCommandAt,
          now: '2026-10-09T00:09:59.999Z',
          idleTimeoutMs: 600_000,
        }),
        expireIdleRoom(
          {
            ...state(),
            prepStartedAt: '2026-10-09T00:05:00.000Z',
            prepRemainingMs: 300_000,
          },
          {
            lastCommandAt,
            now: '2026-10-09T00:14:59.999Z',
            idleTimeoutMs: 600_000,
          },
        ),
        expireIdleRoom(
          { ...state(), status: 'abandoned' },
          { lastCommandAt, now, idleTimeoutMs: 600_000 },
        ),
        expireIdleRoom(withRound('active'), {
          lastCommandAt,
          now,
          idleTimeoutMs: 600_000,
        }),
        JSON.stringify(state()) === before,
      ],
      expected: [null, null, null, null, true],
    });
  });

  test('prep idles from its end, not its start', () => {
    const room = {
      ...state(),
      prepStartedAt: '2026-10-09T00:05:00.000Z',
      prepRemainingMs: 300_000,
    };
    const expired = expireIdleRoom(room, {
      lastCommandAt,
      now: '2026-10-09T00:20:00.000Z',
      idleTimeoutMs: 600_000,
    });
    assert({
      given: 'a Room whose prep ended a full timeout ago',
      should: 'expire it',
      actual: expired?.mutation.state.status,
      expected: 'abandoned',
    });
  });
});
