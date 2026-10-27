import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createRoundMaintenanceOperations } from './maintenance';
setupRitewayBun();

/** A candidate store that pages `ids` two at a time, as the database does. */
const pagedCandidates = (ids: readonly string[]) => ({
  readRoundMaintenanceCandidates: async (input: { afterId?: string }) => {
    const start = input.afterId ? ids.indexOf(input.afterId) + 1 : 0;
    const roundIds = ids.slice(start, start + 2);
    return {
      roundIds,
      afterId: roundIds.at(-1) ?? null,
      exhausted: start + 2 >= ids.length,
    };
  },
});
const operations = (ids: readonly string[], probeRoundId: string | null) =>
  createRoundMaintenanceOperations({
    store: pagedCandidates(ids) as never,
    instanceId: 'webinstance0000000000001',
    ids: { next: () => 'generatedid0000000000001' },
    evaluate: async () => null,
    startHorizonMs: 60_000,
    probeRoundId,
    idleTimeoutMs: null,
  });

test('maintenance discovery leaves the configured probe Round alone (ISSUE-530)', async () => {
  assert({
    given:
      'active candidates across pages, one of them the public check-in probe Round',
    should: 'discover every candidate except the probe Round',
    actual: await operations(
      ['rounda', 'probe', 'roundb', 'roundc'],
      'probe',
    ).discover(),
    expected: ['rounda', 'roundb', 'roundc'],
  });
});

test('maintenance discovery without a probe discovers every candidate', async () => {
  assert({
    given: 'the same candidates and no probe configured',
    should: 'discover all of them',
    actual: await operations(
      ['rounda', 'probe', 'roundb', 'roundc'],
      null,
    ).discover(),
    expected: ['rounda', 'probe', 'roundb', 'roundc'],
  });
});

test('idle Room expiry applies the engine rule under the injected policy (ADR 0070)', async () => {
  const room = (id: string, updatedAt: string) => ({ id, updatedAt });
  const rooms = [
    room('idle', '2026-10-09T00:00:00.000Z'),
    room('busy', '2026-10-09T00:09:00.000Z'),
  ];
  const calls: string[] = [];
  const sweep = (idleTimeoutMs: number | null) =>
    createRoundMaintenanceOperations({
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
      instanceId: 'webinstance0000000000001',
      ids: { next: () => 'generatedid0000000000001' },
      evaluate: async () => null,
      startHorizonMs: 60_000,
      probeRoundId: null,
      idleTimeoutMs,
    }).maintainRooms();
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
      ['candidates:600000', 'idle:abandoned', 'busy:kept'],
    ],
  });
});

test('one Room that cannot be maintained does not stop the rest of the sweep (PR #472 review)', async () => {
  const maintained: string[] = [];
  const failure = new Error('room read failed');
  const outcome = await createRoundMaintenanceOperations({
    store: {
      readMaintenanceCandidates: async () => ['broken', 'next'],
      maintainRoom: async (input: { roomId: string }) => {
        if (input.roomId === 'broken') throw failure;
        maintained.push(input.roomId);
        return false;
      },
    } as never,
    instanceId: 'webinstance0000000000001',
    ids: { next: () => 'generatedid0000000000001' },
    evaluate: async () => null,
    startHorizonMs: 60_000,
    probeRoundId: null,
    idleTimeoutMs: null,
  })
    .maintainRooms()
    .then(
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
