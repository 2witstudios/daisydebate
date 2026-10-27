import { assert, setupRitewayBun, test } from 'riteway/bun';
import { failureLog, manualTimers } from '../../lib/worker-timers.test-support';
import { createRoomMaintenance, startRoomMaintenance } from './maintenance';
setupRitewayBun();

test('idle Room expiry applies the engine rule under the injected policy (ADR 0070)', async () => {
  const room = (id: string, updatedAt: string) => ({ id, updatedAt });
  const rooms = [
    room('idle', '2026-10-09T00:00:00.000Z'),
    room('busy', '2026-10-09T00:09:00.000Z'),
  ];
  const calls: string[] = [];
  const sweep = (idleTimeoutMs: number | null) =>
    createRoomMaintenance({
      store: {
        readMaintenanceCandidates: async (input: {
          idleTimeoutMs: number | null;
        }) => {
          calls.push(`candidates:${input.idleTimeoutMs}`);
          return rooms.map((r) => r.id);
        },
        maintainRoom: async (input: {
          roomId: string;
          maintain: (
            state: unknown,
            facts: { lastCommandAt: string; now: string; drawSeed: null },
          ) => { mutation: { state: { status: string } } } | null;
        }) => {
          const candidate = rooms.find((r) => r.id === input.roomId)!;
          const outcome = input.maintain(
            {
              status: 'assembling',
              changeVersion: 1,
              hostActorId: 'host',
              participants: [],
              roundRef: null,
              prepStartedAt: null,
              prepRemainingMs: null,
              resolutionDraw: null,
              executionPlan: {
                preRoundPrep: { enabled: false },
                resolutionDraw: { enabled: false },
              },
            },
            {
              lastCommandAt: candidate.updatedAt,
              now: '2026-10-09T00:10:00.000Z',
              drawSeed: null,
            },
          );
          calls.push(
            `${input.roomId}:${outcome?.mutation.state.status ?? 'kept'}`,
          );
          return outcome !== null;
        },
      } as never,
      idleTimeoutMs,
    })(() => {
      throw new Error('no Room should fail');
    });
  await sweep(null);
  const inert = [...calls];
  await sweep(600_000);
  assert({
    given:
      'no idle timeout, then a ten minute timeout over an idle and a busy Room',
    should:
      'still maintain without a policy but close nothing, then close only the Room idle past it',
    actual: [inert, calls.slice(inert.length)],
    expected: [
      ['candidates:null', 'idle:kept', 'busy:kept'],
      ['candidates:600000', 'idle:closed', 'busy:kept'],
    ],
  });
});

test('one Room that cannot be maintained does not stop the rest of the sweep (PR #472 review)', async () => {
  const maintained: string[] = [];
  const failure = new Error('room read failed');
  const { failures, failed } = failureLog();
  await createRoomMaintenance({
    store: {
      readMaintenanceCandidates: async () => ['broken', 'next'],
      maintainRoom: async (input: { roomId: string }) => {
        if (input.roomId === 'broken') throw failure;
        maintained.push(input.roomId);
        return false;
      },
    } as never,
    idleTimeoutMs: null,
  })(failed);
  assert({
    given: 'a page whose first Room throws',
    should:
      "still maintain the next Room and report that Room's own error at the maintain stage",
    actual: { maintained, failures },
    expected: { maintained: ['next'], failures: [[failure, 'maintain']] },
  });
});

test('Room maintenance runs on its own 500 ms single-flight timer (ISSUE-771)', async () => {
  const { tasks, timers } = manualTimers();
  const { failures, failed } = failureLog();
  const pageFailure = new Error('page read failed');
  const service = startRoomMaintenance({
    maintainRooms: async () => {
      throw pageFailure;
    },
    timers,
    failed,
  });
  await service.started;
  const pulse = tasks.get(500);
  await service.stop();
  assert({
    given: 'a pass whose page read fails, then a stop',
    should:
      'pulse every 500 ms, report the failure at the discover stage and clear its interval',
    actual: { pulsed: pulse !== undefined, failures, cleared: !tasks.has(500) },
    expected: {
      pulsed: true,
      failures: [[pageFailure, 'discover']],
      cleared: true,
    },
  });
});
