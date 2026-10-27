import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { RoomAssemblyState } from '@daisy/protocol';
import { maintainRoom } from './room-expiry';
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
    const expired = maintainRoom(room, {
      lastCommandAt,
      now: '2026-10-09T00:10:00.000Z',
      idleTimeoutMs: 600_000,
      drawSeed: null,
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
        maintainRoom(state(), {
          lastCommandAt,
          now: '2026-10-09T00:09:59.999Z',
          idleTimeoutMs: 600_000,
          drawSeed: null,
        }),
        maintainRoom(
          {
            ...state(),
            prepStartedAt: '2026-10-09T00:05:00.000Z',
            prepRemainingMs: 300_000,
          },
          {
            lastCommandAt,
            now: '2026-10-09T00:14:59.999Z',
            idleTimeoutMs: 600_000,
            drawSeed: null,
          },
        ),
        maintainRoom(
          { ...state(), status: 'abandoned' },
          { lastCommandAt, now, idleTimeoutMs: 600_000, drawSeed: null },
        ),
        maintainRoom(withRound('active'), {
          lastCommandAt,
          now,
          idleTimeoutMs: 600_000,
          drawSeed: null,
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
    const expired = maintainRoom(room, {
      lastCommandAt,
      now: '2026-10-09T00:20:00.000Z',
      idleTimeoutMs: 600_000,
      drawSeed: null,
    });
    assert({
      given: 'a Room whose prep ended a full timeout ago',
      should: 'expire it',
      actual: expired?.mutation.state.status,
      expected: 'abandoned',
    });
  });
});

describe('maintenance with a draw', () => {
  const lastCommandAt = '2026-10-09T00:00:00.000Z';
  const striking = (): RoomAssemblyState => ({
    ...state(),
    topic: null,
    executionPlan: {
      preRoundPrep: { enabled: false },
      resolutionDraw: {
        enabled: true,
        drawSize: 3,
        strikeWindowMs: 180_000,
        firstStriker: 'negative',
        source: { kind: 'host', resolutions: ['A', 'B', 'C'] },
      },
    },
    resolutionDraw: {
      id: 'draw',
      manifest: {
        version: 1,
        algorithm: 'daisy-draw-v1',
        roomId: 'room00000000000000000000',
        drawId: 'draw00000000000000000000',
        source: { kind: 'host', count: 3 },
        drawSize: 3,
        firstStriker: 'negative',
        strikeWindowMs: 180_000,
        controllers: { affirmative: 'human', negative: 'human' },
        inputCommitment: '0'.repeat(64),
      },
      manifestDigest: '0'.repeat(64),
      commitment: '0'.repeat(64),
      items: ['A', 'B', 'C'].map((text, position) => ({
        position,
        candidateId: `h:${position}`,
        text,
        category: null,
      })),
      startedAt: lastCommandAt,
      strikes: [],
    },
  });

  test('a pending human turn is never cut short by a shorter idle timeout', () => {
    assert({
      given: 'a 180-second turn and a 30-second idle timeout, 60 seconds in',
      should: 'neither settle nor expire',
      actual: maintainRoom(striking(), {
        lastCommandAt,
        now: '2026-10-09T00:01:00.000Z',
        idleTimeoutMs: 30_000,
        drawSeed: null,
      }),
      expected: null,
    });
  });

  test('a long outage settles every due strike, then idles from the reveal', () => {
    const settledOnly = maintainRoom(striking(), {
      lastCommandAt,
      now: '2026-10-09T00:06:10.000Z',
      idleTimeoutMs: 30_000,
      drawSeed: null,
    });
    const later = maintainRoom(striking(), {
      lastCommandAt,
      now: '2026-10-09T00:06:30.000Z',
      idleTimeoutMs: 30_000,
      drawSeed: null,
    });
    assert({
      given: 'both turns timed out by 6:00 and the sweep running at 6:10',
      should: 'reveal C without expiring, since the reveal is 10 seconds old',
      actual: settledOnly && [
        settledOnly.mutation.state.status,
        settledOnly.mutation.state.topic,
      ],
      expected: ['ready', 'C'],
    });
    assert({
      given: 'the sweep running a full timeout after the reveal',
      should: 'settle and close in one step',
      actual: later && [
        later.mutation.state.status,
        later.mutation.state.topic,
      ],
      expected: ['abandoned', 'C'],
    });
  });

  test('with expiry unset, settlement still runs', () => {
    assert({
      given: 'no idle timeout and a due strike',
      should: 'settle it and keep the Room open',
      actual: maintainRoom(striking(), {
        lastCommandAt,
        now: '2026-10-09T00:03:00.000Z',
        idleTimeoutMs: null,
        drawSeed: null,
      })?.mutation.state.resolutionDraw?.strikes.length,
      expected: 1,
    });
  });
});
