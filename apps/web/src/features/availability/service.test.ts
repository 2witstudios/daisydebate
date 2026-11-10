import { isAppError } from '@daisy/errors';
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
    lapsing: { log: () => {}, report: () => {} },
    nextId: () => 's'.repeat(24),
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
    lapsing: { log: () => {}, report: () => {} },
    nextId: () => 's'.repeat(24),
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
    lapsing: { log: () => {}, report: () => {} },
    nextId: () => 's'.repeat(24),
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
    lapsing: { log: () => {}, report: () => {} },
    nextId: () => 's'.repeat(24),
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

test('a lease left unproven for ten seconds is told once per channel, and a stop never is', async () => {
  const refused = new Error('renewal refused');
  const told: unknown[] = [];
  let tick = () => {};
  let nowMs = 0;
  let failing = true;
  let reports = 0;
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
    lapsing: {
      log: (lapse) => void told.push(['log', lapse.lapsedMs]),
      report: (lapse) => {
        told.push(['report', lapse.lapsedMs, lapse.unproven]);
        if (++reports === 1) throw new Error('tracker down');
      },
    },
    failed: () => {},
    nextId: () => 's'.repeat(24),
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
  const why = { kind: 'renewal_failed', error: refused };
  assert({
    given:
      'renewals failing for twelve ticks from start with a tracker that throws once, a timely renewal, then a stop a minute later',
    should:
      'log once, retry only the report that threw on the next tick, and stay silent after the stop',
    actual: told,
    expected: [
      ['log', 10_000],
      ['report', 10_000, why],
      ['report', 11_000, why],
    ],
  });
});

/** A service whose every renewal behaves as `renew` says, ticked by hand. */
function ticked(
  renew: () => Promise<void>,
  channels: {
    readonly logThrows?: boolean;
    readonly reportThrows?: boolean;
  } = {},
) {
  const logs: unknown[] = [];
  const reports: unknown[] = [];
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
    lapsing: {
      log: (lapse) => {
        logs.push(lapse);
        if (channels.logThrows) throw new Error('log down');
      },
      report: (lapse) => {
        reports.push(lapse);
        if (channels.reportThrows) throw new Error('tracker down');
      },
    },
    failed: () => {
      throw new Error('failure sink broke');
    },
    nextId: () => 's'.repeat(24),
  });
  const advance = async (seconds: number) => {
    for (let i = 0; i < seconds; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      state.nowMs += 1000;
      state.tick();
    }
  };
  return { logs, reports, advance, service };
}

const hung = () => new Promise<void>(() => {});

test('a renewal that never settles is abandoned at its deadline, and the lapse reports', async () => {
  let calls = 0;
  const { logs, reports, advance } = ticked(() => {
    calls += 1;
    return new Promise(() => {});
  });
  await advance(13);
  const [report] = reports as {
    lapsedMs: number;
    unproven: { kind: string; error: unknown };
  }[];
  assert({
    given:
      'renewals that never settle, with the ticks running for thirteen seconds',
    should:
      'start a new renewal each time one passes its 6 s deadline, and log and report the lapse once at 10 s as a failed, hung renewal',
    actual: {
      calls,
      logs: logs.length,
      reports: reports.length,
      lapsedMs: report?.lapsedMs,
      kind: report?.unproven.kind,
      code: isAppError(report?.unproven.error)
        ? report.unproven.error.code
        : null,
    },
    expected: {
      calls: 3,
      logs: 1,
      reports: 1,
      lapsedMs: 10_000,
      kind: 'renewal_failed',
      code: 'INFRASTRUCTURE',
    },
  });
});

test('each channel that failed is retried alone, never repeating the other', async () => {
  const tracker = ticked(hung, { reportThrows: true });
  await tracker.advance(20);
  const log = ticked(hung, { logThrows: true });
  await log.advance(20);
  assert({
    given:
      'a hung renewal over twenty seconds, once with a tracker that always throws and once with a log that always throws',
    should:
      'retry only the failing channel on each tick from 10 s, and deliver the working one once',
    actual: {
      trackerDown: [tracker.logs.length, tracker.reports.length],
      logDown: [log.logs.length, log.reports.length],
    },
    expected: { trackerDown: [1, 11], logDown: [11, 1] },
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

test('a store that throws before returning a promise is still a failed renewal', async () => {
  const thrown = new Error('adapter broke synchronously');
  const { reports, advance, service } = ticked(() => {
    throw thrown;
  });
  let rejected: unknown = null;
  try {
    await advance(12);
    await service.stop();
  } catch (error) {
    rejected = error;
  }
  assert({
    given: 'a store whose renewal throws synchronously on every tick',
    should:
      'record each as a failed renewal and report the lapse without throwing',
    actual: { rejected, reports },
    expected: {
      rejected: null,
      reports: [
        {
          lapsedMs: 10_000,
          unproven: { kind: 'renewal_failed', error: thrown },
        },
      ],
    },
  });
});
