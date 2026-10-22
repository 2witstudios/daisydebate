import { assert, setupRitewayBun, test } from 'riteway/bun';
import { startAvailabilityService } from './service';
setupRitewayBun();

for (const elected of [true, false])
  test(`availability loop election=${elected} renews its lease and awaits only elected sampling work on shutdown`, async () => {
    let tick = () => {};
    const evidence: unknown[] = [];
    const events: string[] = [];
    let probeHealthy = false;
    let unhealthyControl = true;
    let probes = 0;
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
        probes += 1;
        return probeHealthy;
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
    await service.stop();
    probeHealthy = true;
    unhealthyControl = false;
    tick();
    assert({
      given:
        'failed actual probe and unknown own bot controller, then shutdown',
      should:
        'sample unhealthy and stop renewal/sampling before releasing election',
      actual: { evidence, events, probes },
      expected: {
        evidence: elected
          ? [{ publicProbeHealthy: false, controlWorkersHealthy: false }]
          : [],
        probes: elected ? 1 : 0,
        events: ['interval:1000', 'renew', 'clear', 'close'],
      },
    });
  });
