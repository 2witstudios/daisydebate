import { assert, setupRitewayBun, test } from 'riteway/bun';
import { startAvailabilityService } from './service';
import {
  inertTimers,
  withOneShots,
} from '../../lib/worker-timers.test-support';
setupRitewayBun();

test('a graceful elected sampler handoff measures fresh public health before releasing election', async () => {
  let now = 0;
  let owner: string | null = null;
  const samples: { at: number; healthy: boolean; owner: string }[] = [];
  const events: string[] = [];
  const peer = (id: string) => {
    let tick = () => {};
    const service = startAvailabilityService({
      instanceId: id,
      nowMs: () => now,
      nextId: () => id,
      store: {
        renewServiceInstance: async () => {},
        reconcileRoundCheckInAttempts: async () => 0,
        availabilitySampler: () => ({
          elect: async () => {
            owner ??= id;
            return owner === id;
          },
          sample: async ({ publicProbeHealthy }) => {
            samples.push({ at: now, healthy: publicProbeHealthy, owner: id });
          },
          close: async () => {
            events.push(`close:${id}`);
            if (owner === id) owner = null;
          },
        }),
      },
      probe: async () => {
        events.push(`probe:${id}`);
        now += 100;
        return true;
      },
      timers: withOneShots({
        setInterval: (callback) => {
          tick = callback;
          return 1;
        },
        clearInterval: () => {},
      }),
      failed: () => {
        events.push('failed');
      },
      lapsing: { log: () => {}, report: () => {} },
    });
    return { service, tick: () => tick() };
  };
  const leader = peer('leader');
  await new Promise<void>((resolve) => setImmediate(resolve));
  const follower = peer('follower');
  await new Promise<void>((resolve) => setImmediate(resolve));
  now = 1500;
  await leader.service.stop();
  const atRelease = samples.at(-1)?.at;
  now = 2300;
  follower.tick();
  await new Promise<void>((resolve) => setImmediate(resolve));
  const gaps = samples.slice(1).map((sample, i) => sample.at - samples[i]!.at);
  await follower.service.stop();
  assert({
    given:
      'a healthy peer whose next election is2300ms after the last ordinary leader tick',
    should:
      'make a fresh genuine observation before unlocking, keeping the handoff gap under the unchanged2s bound',
    actual: {
      atRelease,
      bounded: gaps.every((gap) => gap <= 2000),
      healthy: samples.every((sample) => sample.healthy),
      order: events.slice(0, 4),
    },
    expected: {
      atRelease: 1600,
      bounded: true,
      healthy: true,
      order: ['probe:leader', 'probe:leader', 'close:leader', 'probe:follower'],
    },
  });
});

for (const fault of ['probe', 'reconcile', 'sample', 'nonelected'] as const)
  test(`shutdown handoff ${fault} preserves refusal and releases election`, async () => {
    let shuttingDown = false;
    const samples: boolean[] = [];
    const events: string[] = [];
    const service = startAvailabilityService({
      instanceId: 'leader',
      nowMs: () => 0,
      nextId: () => 'leader',
      store: {
        renewServiceInstance: async () => {},
        reconcileRoundCheckInAttempts: async () => {
          if (shuttingDown && fault === 'reconcile')
            throw new Error('unavailable');
          return 0;
        },
        availabilitySampler: () => ({
          elect: async () => !(shuttingDown && fault === 'nonelected'),
          sample: async ({ publicProbeHealthy }) => {
            if (shuttingDown && fault === 'sample')
              throw new Error('unavailable');
            samples.push(publicProbeHealthy);
          },
          close: async () => {
            events.push('close');
          },
        }),
      },
      probe: async () => !(shuttingDown && fault === 'probe'),
      timers: inertTimers,
      failed: () => {
        events.push('failed');
      },
      lapsing: { log: () => {}, report: () => {} },
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    shuttingDown = true;
    await service.stop();
    assert({
      given: `the actual final ${fault} boundary refuses`,
      should:
        'never invent healthy evidence, report a failed write and always release election',
      actual: { samples, events },
      expected: {
        samples: ['probe', 'reconcile'].includes(fault)
          ? [true, false]
          : [true],
        events: fault === 'sample' ? ['failed', 'close'] : ['close'],
      },
    });
  });
