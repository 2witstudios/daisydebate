import { assert, setupRitewayBun, test } from 'riteway/bun';
import { startAvailabilityService } from './service';
setupRitewayBun();

test('availability loop samples actual probe/control results and awaits its own work on shutdown', async () => {
  let tick = () => {};
  const evidence: unknown[] = [];
  const events: string[] = [];
  let probeHealthy = false;
  let unhealthyControl = true;
  let resolveSample!: () => void;
  const sampled = new Promise<void>((resolve) => {
    resolveSample = resolve;
  });
  const service = startAvailabilityService({
    instanceId: 'a'.repeat(24),
    store: {
      reconcileRoundCheckInAttempts: async () => 0,
      renewServiceInstance: async () => {
        events.push('renew');
      },
      readRoundBotControlHealth: async () => {
        if (unhealthyControl) throw new Error('Unavailable controller read');
        return { healthy: true };
      },
      availabilitySampler: () => ({
        sample: async (input) => {
          evidence.push(input);
          resolveSample();
        },
        close: async () => {
          events.push('close');
        },
      }),
    },
    probe: async () => probeHealthy,
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
  await sampled;
  await service.stop();
  probeHealthy = true;
  unhealthyControl = false;
  tick();
  assert({
    given: 'failed actual probe and unknown own bot controller, then shutdown',
    should:
      'sample unhealthy and stop renewal/sampling before releasing election',
    actual: { evidence, events },
    expected: {
      evidence: [{ publicProbeHealthy: false, controlWorkersHealthy: false }],
      events: ['interval:1000', 'renew', 'clear', 'close'],
    },
  });
});
