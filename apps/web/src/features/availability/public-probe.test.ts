import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createPublicCheckInProbe } from './public-probe';
setupRitewayBun();
test('unconfigured public ingress is unhealthy', async () => {
  assert({
    given: 'no isolated configured synthetic participant',
    should: 'never infer healthy from process leases',
    actual: await createPublicCheckInProbe({
      configuration: null,
      nextId: () => 'a'.repeat(24),
      fetch: () => {
        throw new Error('must not call');
      },
    })(),
    expected: false,
  });
});
test('public probe validates actual receipt identity rather than a health status', async () => {
  const roundId = 'a'.repeat(24),
    segmentId = 'b'.repeat(24),
    participantId = 'c'.repeat(24),
    commandId = 'd'.repeat(24);
  const config = {
    origin: 'http://localhost:13140',
    roundId,
    segmentId,
    participantId,
    cookie: 'isolated-fixture-only',
  };
  for (const body of [
    { ok: true },
    {
      version: 1,
      commandId,
      roundId,
      segmentId,
      participantId: 'e'.repeat(24),
      receivedAt: '2026-10-22T00:00:00.000Z',
      resultingVersion: 1,
      replayed: true,
    },
  ]) {
    let path = '';
    const probe = createPublicCheckInProbe({
      configuration: config,
      nextId: () => commandId,
      fetch: async (request) => {
        path = String(request);
        return Response.json(body);
      },
    });
    assert({
      given: 'HTTP200 with missing or foreign attendance receipt',
      should: 'mark public path unhealthy',
      actual: await probe(),
      expected: false,
    });
    assert({
      given: 'configured public origin',
      should: 'call the actual shared check-in route',
      actual: path,
      expected: `http://localhost:13140/api/rounds/${roundId}/check-in`,
    });
  }
});
