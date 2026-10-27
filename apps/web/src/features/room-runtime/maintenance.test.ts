import { assert, setupRitewayBun, test } from 'riteway/bun';
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
    })();
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
  const outcome = await createRoomMaintenance({
    store: {
      readMaintenanceCandidates: async () => ['broken', 'next'],
      maintainRoom: async (input: { roomId: string }) => {
        if (input.roomId === 'broken') throw failure;
        maintained.push(input.roomId);
        return false;
      },
    } as never,
    idleTimeoutMs: null,
  })().then(
    () => null,
    (error: unknown) => error,
  );
  assert({
    given: 'a page whose first Room throws',
    should:
      'still maintain the next Room, then report the failure once the page is done',
    actual: {
      maintained,
      reported:
        outcome instanceof AggregateError ? outcome.errors : 'not reported',
    },
    expected: { maintained: ['next'], reported: [failure] },
  });
});

test('Room maintenance runs on its own timer, one pass at a time (ISSUE-771)', async () => {
  const failure = new Error('page failed');
  const failed: unknown[] = [];
  let interval: number | undefined;
  let pulse: (() => Promise<void>) | undefined;
  let passes = 0;
  let release!: () => void;
  const held = new Promise<void>((done) => {
    release = done;
  });
  const service = startRoomMaintenance({
    maintainRooms: async () => {
      passes += 1;
      await held;
      throw failure;
    },
    timers: {
      setInterval: (tick: () => Promise<void>, ms: number) => {
        interval = ms;
        pulse = tick;
        return 1;
      },
      clearInterval: () => {},
    },
    failed: (error) => failed.push(error),
  });
  void pulse?.();
  release();
  await service.ready;
  await service.stop();
  await pulse?.();
  assert({
    given:
      'a pass still running when the next pulse fires, a failing pass, then a pulse after stop',
    should:
      'pulse every 500ms, skip the overlapping pulse, report the failure once and run nothing after stop',
    actual: { interval, passes, failed },
    expected: { interval: 500, passes: 1, failed: [failure] },
  });
});
