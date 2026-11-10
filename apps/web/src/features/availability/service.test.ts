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
    nowMs: () => 0,
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
    lapsing: () => true,
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

test('missing probe resources are named at start and hourly, and never decide health', async () => {
  let tick = async () => {};
  let clock = 0;
  const invalid: string[] = [];
  const samples: unknown[] = [];
  let reads = 0;
  const service = startAvailabilityService({
    instanceId: 'a'.repeat(24),
    store: {
      reconcileRoundCheckInAttempts: async () => 0,
      renewServiceInstance: async () => {},
      availabilitySampler: () => ({
        elect: async () => true,
        sample: async (input) => {
          samples.push(input);
        },
        close: async () => {},
      }),
    },
    probe: async () => true,
    probeResources: async () => {
      reads += 1;
      return ['round_missing', 'participant_missing'];
    },
    probeInvalid: (problem) => invalid.push(problem),
    nowMs: () => clock,
    timers: {
      setInterval: (callback) => {
        tick = callback;
        return 1;
      },
      clearInterval: () => {},
    },
    failed: () => {},
    lapsing: () => true,
  });
  const settle = async () => {
    for (let n = 0; n < 12; n++) await Promise.resolve();
  };
  await settle();
  assert({
    given: 'a configured probe whose Round and participant are gone',
    should: 'name each problem at start, leaving the sample to the real probe',
    actual: { invalid, samples },
    expected: {
      invalid: ['round_missing', 'participant_missing'],
      samples: [{ publicProbeHealthy: true }],
    },
  });
  await tick();
  await settle();
  assert({
    given: 'the next second',
    should: 'not read them again',
    actual: reads,
    expected: 1,
  });
  clock = 60 * 60_000;
  await tick();
  await settle();
  assert({
    given: 'an hour later',
    should: 'check again',
    actual: reads,
    expected: 2,
  });
  await service.stop();
});

test('every process checks the probe resources at start, elected or not', async () => {
  const invalid: string[] = [];
  const service = startAvailabilityService({
    instanceId: 'a'.repeat(24),
    store: {
      reconcileRoundCheckInAttempts: async () => 0,
      renewServiceInstance: async () => {},
      availabilitySampler: () => ({
        elect: async () => false,
        sample: async () => {},
        close: async () => {},
      }),
    },
    probe: async () => true,
    probeResources: async () => ['segment_missing'],
    probeInvalid: (problem) => invalid.push(problem),
    nowMs: () => 0,
    timers: { setInterval: () => 1, clearInterval: () => {} },
    failed: () => {},
    lapsing: () => true,
  });
  await service.probeChecked;
  assert({
    given: 'a process that lost the sampler election',
    should: 'still name the problem before readiness opens',
    actual: invalid,
    expected: ['segment_missing'],
  });
  await service.stop();
});

test('a failing probe check waits a minute, not a second', async () => {
  let tick = async () => {};
  let clock = 0;
  let reads = 0;
  const invalid: string[] = [];
  const service = startAvailabilityService({
    instanceId: 'a'.repeat(24),
    store: {
      reconcileRoundCheckInAttempts: async () => 0,
      renewServiceInstance: async () => {},
      availabilitySampler: () => ({
        elect: async () => true,
        sample: async () => {},
        close: async () => {},
      }),
    },
    probe: async () => true,
    probeResources: async () => {
      reads += 1;
      throw new Error('pool saturated');
    },
    probeInvalid: (problem) => invalid.push(problem),
    nowMs: () => clock,
    timers: {
      setInterval: (callback) => {
        tick = callback;
        return 1;
      },
      clearInterval: () => {},
    },
    failed: () => {},
    lapsing: () => true,
  });
  await service.probeChecked;
  const pass = async () => {
    await tick();
    for (let n = 0; n < 12; n++) await Promise.resolve();
  };
  clock = 1_000;
  await pass();
  const afterASecond = reads;
  clock = 61_000;
  await pass();
  assert({
    given: 'a check that fails',
    should: 'not retry at the next second, and retry after a minute',
    actual: { afterASecond, afterAMinute: reads, reported: invalid.length },
    expected: { afterASecond: 1, afterAMinute: 2, reported: 2 },
  });
  await service.stop();
});

test('a lease left unproven for ten seconds reports once, and a stop never does', async () => {
  const refused = new Error('renewal refused');
  const lapses: unknown[] = [];
  let tick = () => {};
  let nowMs = 0;
  let failing = true;
  const service = startAvailabilityService({
    instanceId: 'a'.repeat(24),
    store: {
      reconcileRoundCheckInAttempts: async () => 0,
      renewServiceInstance: async () => {
        if (failing) throw refused;
      },
      availabilitySampler: () => ({
        elect: async () => false,
        sample: async () => undefined,
        close: async () => undefined,
      }),
    },
    probe: async () => false,
    nowMs: () => nowMs,
    timers: {
      setInterval: (callback) => {
        tick = callback;
        return 1;
      },
      clearInterval: () => {},
    },
    lapsing: (lapse) => {
      lapses.push(lapse);
      if (lapses.length === 1) throw new Error('reporter broke');
      return true;
    },
    failed: () => {},
  });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  for (let i = 0; i < 12; i++) {
    await settle();
    nowMs += 1000;
    tick();
  }
  failing = false;
  await settle();
  nowMs += 1000;
  tick();
  await settle();
  await service.stop();
  nowMs += 60_000;
  tick();
  assert({
    given:
      'renewals failing for twelve one-second ticks from start with a reporter that throws once, a timely renewal, then a stop a minute later',
    should:
      'retry a report whose send threw on the next tick, count only the one sent, and stay silent after the stop',
    actual: lapses,
    expected: [
      {
        lapsedMs: 10_000,
        unproven: { kind: 'renewal_failed', error: refused },
      },
      {
        lapsedMs: 11_000,
        unproven: { kind: 'renewal_failed', error: refused },
      },
    ],
  });
});

/** A service whose every renewal behaves as `renew` says, ticked by hand. */
function ticked(renew: () => Promise<void>, reached = true) {
  const lapses: unknown[] = [];
  const state = { nowMs: 0, tick: () => {} };
  const service = startAvailabilityService({
    instanceId: 'a'.repeat(24),
    store: {
      reconcileRoundCheckInAttempts: async () => 0,
      renewServiceInstance: renew,
      availabilitySampler: () => ({
        elect: async () => false,
        sample: async () => undefined,
        close: async () => undefined,
      }),
    },
    probe: async () => false,
    nowMs: () => state.nowMs,
    timers: {
      setInterval: (callback) => {
        state.tick = callback;
        return 1;
      },
      clearInterval: () => {},
    },
    lapsing: (lapse) => {
      lapses.push(lapse);
      return reached;
    },
    failed: () => {
      throw new Error('failure sink broke');
    },
  });
  const advance = async (seconds: number) => {
    for (let i = 0; i < seconds; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      state.nowMs += 1000;
      state.tick();
    }
  };
  return { lapses, advance, service };
}

test('a renewal that never settles is still checked on every tick, and reports', async () => {
  const { lapses, advance } = ticked(() => new Promise(() => {}));
  await advance(12);
  assert({
    given:
      'a renewal that hangs from start, with the ticks running for twelve seconds',
    should: 'report one lapse of ten seconds with the renewal still pending',
    actual: lapses,
    expected: [{ lapsedMs: 10_000, unproven: { kind: 'renewal_pending' } }],
  });
});

test('a report that reached no one is retried every tick, one that was logged is not', async () => {
  const unreached = ticked(() => new Promise(() => {}), false);
  await unreached.advance(15);
  const logged = ticked(() => new Promise(() => {}));
  await logged.advance(60);
  assert({
    given:
      'a hung renewal reported through a sink that reached no one for five ticks, and one that was logged, over a minute',
    should:
      'retry the unreached report on each tick, and count the logged one once',
    actual: [unreached.lapses.length, logged.lapses.length],
    expected: [6, 1],
  });
});

test('a failure sink that throws never rejects the renewal', async () => {
  const refused = new Error('renewal refused');
  const { advance, service } = ticked(async () => {
    throw refused;
  });
  let rejected: unknown = null;
  try {
    await advance(3);
    await service.stop();
  } catch (error) {
    rejected = error;
  }
  assert({
    given: 'failing renewals whose failure sink throws',
    should: 'keep renewing and stop cleanly',
    actual: rejected,
    expected: null,
  });
});
