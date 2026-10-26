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

test('idle Room expiry applies the engine rule under the injected policy (ADR 0069)', async () => {
  const room = (id: string, updatedAt: string) => ({ id, updatedAt });
  const rooms = [
    room('idle', '2026-10-09T00:00:00.000Z'),
    room('busy', '2026-10-09T00:09:00.000Z'),
  ];
  const calls: string[] = [];
  const sweep = (idleTimeoutMs: number | null) =>
    createRoundMaintenanceOperations({
      store: {
        readIdleRoomCandidates: async (input: { idleTimeoutMs: number }) => {
          calls.push(`candidates:${input.idleTimeoutMs}`);
          return rooms.map((r) => r.id);
        },
        expireIdleRoom: async (input: {
          roomId: string;
          expire: (
            state: unknown,
            facts: { lastCommandAt: string; now: string },
          ) => { mutation: { state: { status: string } } } | null;
        }) => {
          const candidate = rooms.find((r) => r.id === input.roomId)!;
          const outcome = input.expire(
            {
              status: 'assembling',
              changeVersion: 1,
              hostActorId: 'host',
              participants: [],
              roundRef: null,
              prepStartedAt: null,
              prepRemainingMs: null,
            },
            {
              lastCommandAt: candidate.updatedAt,
              now: '2026-10-09T00:10:00.000Z',
            },
          );
          calls.push(`${input.roomId}:${outcome?.mutation.state.status ?? 'kept'}`);
          return outcome !== null;
        },
      } as never,
      instanceId: 'webinstance0000000000001',
      ids: { next: () => 'generatedid0000000000001' },
      evaluate: async () => null,
      startHorizonMs: 60_000,
      probeRoundId: null,
      idleTimeoutMs,
    }).expireIdleRooms();
  await sweep(null);
  const inert = [...calls];
  await sweep(600_000);
  assert({
    given: 'no idle timeout, then a ten minute timeout over an idle and a busy Room',
    should:
      'leave expiry inert without a policy, then close only the Room idle past it',
    actual: [inert, calls],
    expected: [[], ['candidates:600000', 'idle:abandoned', 'busy:kept']],
  });
});
