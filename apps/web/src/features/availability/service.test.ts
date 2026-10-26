import { assert, setupRitewayBun, test } from 'riteway/bun';
import { startAvailabilityService } from './service';
setupRitewayBun();

function fixture(elected: boolean, reconcile?: () => Promise<number>) {
  let tick = () => {};
  const evidence: unknown[] = [];
  const events: string[] = [];
  const state = { probeHealthy: false, probes: 0 };
  const service = startAvailabilityService({
    instanceId: 'a'.repeat(24),
    store: {
      reconcileRoundCheckInAttempts: reconcile ?? (async () => 0),
      renewServiceInstance: async () => {
        events.push('renew');
      },
      availabilitySampler: () => ({
        elect: async () => elected,
        sample: async (input) => {
          evidence.push(input);
        },
        close: async () => {
          events.push('close');
        },
      }),
    },
    probe: async () => {
      state.probes += 1;
      return state.probeHealthy;
    },
    timers: {
      setInterval: (callback, ms) => {
        tick = callback;
        events.push(`interval:${ms}`);
        return 1;
      },
      clearInterval: () => {
        events.push('clear');
      },
    },
    failed: () => {
      events.push('failed');
    },
  });
  return { service, tick: () => tick(), state, evidence, events };
}

for (const elected of [true, false])
  test(`availability loop election=${elected} renews its lease and awaits only elected sampling work on shutdown`, async () => {
    const { service, tick, state, evidence, events } = fixture(elected);
    await service.stop();
    state.probeHealthy = true;
    tick();
    assert({
      given: 'failed actual probe, then shutdown',
      should:
        'sample unhealthy and stop renewal/sampling before releasing election',
      actual: { evidence, events, probes: state.probes },
      expected: {
        evidence: elected ? [{ publicProbeHealthy: false }] : [],
        probes: elected ? 1 : 0,
        events: ['interval:1000', 'renew', 'clear', 'close'],
      },
    });
  });

test('pending elected sampling cannot suppress the same peer lease cadence', async () => {
  const held = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const { service, tick, events, state } = fixture(true, async () => {
    held.resolve();
    await release.promise;
    return 0;
  });
  try {
    await held.promise;
    tick();
    assert({
      given:
        'elected reconciliation work held across the next one-second callback',
      should: 'renew again without a second probe or concurrent sample',
      actual: [
        events.filter((event) => event === 'renew').length,
        state.probes,
      ],
      expected: [2, 1],
    });
  } finally {
    release.resolve();
    await service.stop();
  }
});
