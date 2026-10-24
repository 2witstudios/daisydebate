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
