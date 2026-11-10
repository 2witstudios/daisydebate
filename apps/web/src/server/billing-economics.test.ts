import { chmod, mkdtemp, writeFile, readdir, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { fixedClock } from '@daisy/clock';
import { createId } from '@paralleldrive/cuid2';
import { refuseCapacity } from '@daisy/db/testing';
import { createAppError, createRefusal } from '@daisy/errors';
import { createApp } from './app';
import { createEventRecorder, silentLogger } from './test-loggers.test-support';
import {
  composeBillingEconomics,
  economicsFailureCheck,
  startBillingEconomics,
} from './billing-economics';
import { authTestEnv } from '../features/auth/auth-server.test-support';
import { betaMessagingPolicy } from '../features/messaging/beta-policy';
import {
  dataset,
  now,
  month,
} from '../features/billing/economics.test-support';

setupRitewayBun();
const window = { startsAt: month, endsAt: '2026-11-01T00:00:00.000Z' };
const build = (directory?: string) => ({
  ...createApp({
    env: {
      ...authTestEnv,
      DATABASE_URL: 'postgres://unit:unit@localhost:5432/unit',
      REDIS_URL: 'redis://localhost:6379',
      REDIS_NAMESPACE: 'billing-economics-unit',
      LOG_LEVEL: 'silent',
      ...(directory === undefined
        ? {}
        : { BILLING_ECONOMICS_DIRECTORY: directory }),
    },
    messagingPolicy: betaMessagingPolicy,
    clock: fixedClock(now),
    ids: { next: createId },
    fetch: async () => {
      throw new Error('Unexpected network');
    },
  }),
  logger: silentLogger,
});

type Captured = { error: unknown; route: string; errorCode: string };
const snapshotStore =
  (reads: unknown[] = []) =>
  (instanceId: string) => ({
    read: async (period: { startsAt: string; endsAt: string }) => {
      reads.push({ instanceId, ...period });
      return {
        ...period,
        observedAt: now,
        attempts: [],
        usage: [],
        complete: true,
      };
    },
  });
/** Run the worker with controlled ports; `ticks` later hourly ticks follow the immediate one. */
async function runWorker(input: {
  readonly directory?: string;
  readonly ticks: number;
  readonly capture?: (error: unknown, context: Captured) => void;
  readonly between?: (tick: number) => Promise<void>;
  /** Replaces the snapshot read on the given read number (1-based). */
  readonly refuse?: (read: number) => unknown;
  /** Replaces the stored snapshot the store returns. */
  readonly snapshot?: (period: { startsAt: string; endsAt: string }) => unknown;
  /** Makes the logger throw for an event, after recording it. */
  readonly logThrows?: (event: string) => boolean;
}) {
  const app = build(input.directory),
    reads: unknown[] = [],
    captured: Captured[] = [];
  const recorder = createEventRecorder();
  const { logged } = recorder;
  const logger = {
    ...recorder.logger,
    log: (...line: Parameters<typeof recorder.logger.log>) => {
      recorder.logger.log(...line);
      if (input.logThrows?.(line[0])) throw new Error('logger sink');
    },
  };
  let tick: (() => Promise<void>) | null = null;
  let cadence = 0;
  const service = startBillingEconomics({
    app: {
      ...app,
      logger,
      database: {
        ...app.database,
        billingEconomics: (instanceId) => {
          const store = snapshotStore(reads)(instanceId);
          return {
            read: async (period) => {
              const refusal = input.refuse?.(reads.length + 1);
              if (refusal !== undefined) {
                reads.push({ instanceId, ...period });
                throw refusal;
              }
              if (input.snapshot) {
                reads.push({ instanceId, ...period });
                // A deliberately malformed snapshot, past the store's type, for the worker to refuse.
                return input.snapshot(period) as Awaited<
                  ReturnType<typeof store.read>
                >;
              }
              return store.read(period);
            },
          };
        },
      },
      reporter: {
        capture: (error, context) => {
          input.capture?.(error, { error, ...context });
          captured.push({ error, ...context });
        },
      },
    },
    instanceId: 'service-fixture',
    timers: {
      setInterval: (run, ms) => {
        tick = run;
        cadence = ms;
        return 1;
      },
      clearInterval: () => undefined,
    },
  });
  try {
    await service.started;
    for (let n = 1; n <= input.ticks; n++) {
      await input.between?.(n);
      await (tick as (() => Promise<void>) | null)?.();
    }
  } finally {
    await service.stop();
    await app.close();
  }
  return { reads, captured, logged, cadence, scheduled: tick !== null };
}

/** Fill the sink to exactly its 1000-entry cap, so the sweep passes and the save refuses; drain undoes it. */
const fillSink = async (directory: string) => {
  const present = (await readdir(directory)).length;
  for (let n = 0; n < 1000 - present; n++)
    await writeFile(join(directory, `fill-${n}.txt`), '', { mode: 0o600 });
};
const drainSink = async (directory: string) => {
  for (const name of await readdir(directory))
    if (name.startsWith('fill-')) await rm(join(directory, name));
};

test('an unprovisioned sink does not start the worker and raises nothing', async () => {
  const run = await runWorker({ ticks: 2 });
  assert({
    given: 'a process without BILLING_ECONOMICS_DIRECTORY',
    should:
      'schedule nothing, read nothing, capture nothing and log billing.economics.unprovisioned once',
    actual: {
      scheduled: run.scheduled,
      reads: run.reads.length,
      captured: run.captured.length,
      logged: run.logged.map((line) => line.event),
    },
    expected: {
      scheduled: false,
      reads: 0,
      captured: 0,
      logged: ['billing.economics.unprovisioned'],
    },
  });
});

test('a provisioned sink without a feed raises completeness once per month, not every tick', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'billing-economics-worker-'));
  try {
    const run = await runWorker({ directory, ticks: 2 });
    const reports = (await readdir(directory)).filter((name) =>
      name.startsWith('report-'),
    );
    assert({
      given:
        'a provisioned private sink with no feed for the previous month, over three collections',
      should:
        'read the original calendar window each tick, save incomplete reports, and raise one completeness signal per plan once, logged as feed_missing',
      actual: {
        cadence: run.cadence,
        reads: run.reads,
        reports: reports.length,
        captured: run.captured.map((c) => [c.errorCode, c.route]),
        logged: run.logged.map((line) => [line.event, line.fields.cause]),
      },
      expected: {
        cadence: 3_600_000,
        reads: [1, 2, 3].map(() => ({
          instanceId: 'service-fixture',
          ...window,
        })),
        reports: 3,
        captured: [
          ['BILLING_ECONOMICS_INCOMPLETE', 'billing.economics.free'],
          ['BILLING_ECONOMICS_INCOMPLETE', 'billing.economics.beta'],
          ['BILLING_ECONOMICS_INCOMPLETE', 'billing.economics.premium'],
        ],
        logged: [['billing.economics.feed_missing', 'feed_missing']],
      },
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a genuine failure is reported once with its caught error, and a changed outcome is raised', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'billing-economics-worker-'));
  try {
    await chmod(directory, 0o755);
    const run = await runWorker({
      directory,
      ticks: 2,
      between: async (n) => {
        if (n === 2) await chmod(directory, 0o700);
      },
    });
    assert({
      given:
        'a sink directory that is not private for two ticks, then repaired before the third',
      should:
        'capture one typed error carrying the caught error as sink_unavailable (VALIDATION: the directory is misconfigured), then raise the new feed-missing outcome',
      actual: {
        captured: run.captured.map((c) => [
          c.route,
          c.errorCode,
          c.error instanceof Error && c.error.cause instanceof Error
            ? c.error.cause.message
            : c.error instanceof Error
              ? c.error.message
              : null,
        ]),
        logged: run.logged.map((line) => [line.event, line.fields.operation]),
      },
      expected: {
        captured: [
          [
            'billing.economics.sink_unavailable',
            'VALIDATION',
            'Billing economics directory is not private',
          ],
          [
            'billing.economics.free',
            'BILLING_ECONOMICS_INCOMPLETE',
            'BILLING_ECONOMICS_INCOMPLETE',
          ],
          [
            'billing.economics.beta',
            'BILLING_ECONOMICS_INCOMPLETE',
            'BILLING_ECONOMICS_INCOMPLETE',
          ],
          [
            'billing.economics.premium',
            'BILLING_ECONOMICS_INCOMPLETE',
            'BILLING_ECONOMICS_INCOMPLETE',
          ],
        ],
        logged: [
          ['billing.economics.failed', 'billing.economics.sink_unavailable'],
          ['billing.economics.feed_missing', 'billing.economics.collect'],
        ],
      },
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a reporter that throws is logged as signal_failed and retried next tick', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'billing-economics-worker-'));
  let failing = true;
  try {
    const run = await runWorker({
      directory,
      ticks: 1,
      capture: () => {
        if (failing) {
          failing = false;
          throw new Error('private adapter');
        }
      },
    });
    assert({
      given: 'a reporter whose first signal capture throws',
      should:
        'log feed_missing once and signal_failed once, then raise the signals on the next tick',
      actual: {
        logged: run.logged.map((line) => [line.event, line.fields.operation]),
        incomplete: run.captured.filter(
          (c) => c.errorCode === 'BILLING_ECONOMICS_INCOMPLETE',
        ).length,
      },
      expected: {
        logged: [
          ['billing.economics.feed_missing', 'billing.economics.collect'],
          ['billing.economics.failed', 'billing.economics.signal_failed'],
        ],
        incomplete: 3,
      },
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('the composed private-file collector uses the recorded floor and cannot accept a supplier override', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'billing-economics-runtime-'));
  const app = build(directory);
  const source = dataset();
  const { modelUsage: _modelUsage, ...financial } = source;
  void _modelUsage;
  const feed = { ...financial, modelCostBasis: 'provider_invoice' };
  const filename = join(directory, 'feed-2026-10.json');
  try {
    await writeFile(filename, JSON.stringify(feed), { mode: 0o600 });
    const collector = composeBillingEconomics(
      {
        ...app,
        database: {
          ...app.database,
          billingEconomics: () => ({
            read: async (period) => ({
              ...period,
              observedAt: now,
              attempts: [],
              usage: [],
              complete: true,
            }),
          }),
        },
      },
      'service-fixture',
      directory,
    );
    const crossing = await collector.run(window);
    await writeFile(
      filename,
      JSON.stringify({ ...feed, floorBasisPoints: 1000 }),
    );
    const override = await collector.run(window);
    const reports = (await readdir(directory)).filter((name) =>
      name.startsWith('report-'),
    );
    assert({
      given:
        'controlled measured input just below30%, then the same private feed attempting a10% floor',
      should:
        'save one private report deriving the named low-margin signal while refusing the override as feed_invalid',
      actual: {
        crossing: crossing.kind,
        feed: crossing.kind === 'reported' && crossing.feed,
        override: override.kind === 'failed' && override.reason,
        low:
          crossing.kind === 'reported' &&
          crossing.signals.filter((s) => s.name === 'BILLING_LOW_MARGIN')
            .length,
        reports: reports.length,
        mode: reports[0]
          ? (await stat(join(directory, reports[0]))).mode & 0o777
          : null,
      },
      expected: {
        crossing: 'reported',
        feed: 'supplied',
        override: 'feed_invalid',
        low: 1,
        reports: 1,
        mode: 0o600,
      },
    });
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('a deferred capacity refusal never mutes a later genuine failure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'billing-economics-worker-'));
  const genuine = new Error('Economics snapshot unavailable');
  try {
    const run = await runWorker({
      directory,
      ticks: 2,
      refuse: (read) => (read === 1 ? refuseCapacity() : genuine),
    });
    assert({
      given:
        'a capacity refusal on the first snapshot read, then the same genuine failure on two ticks',
      should:
        'defer the refusal silently, then log and capture the genuine failure exactly once',
      actual: {
        logged: run.logged.map((line) => [line.event, line.fields.operation]),
        captured: run.captured.map((c) => [
          c.route,
          c.errorCode,
          c.error instanceof Error && c.error.cause === genuine,
        ]),
      },
      expected: {
        logged: [
          ['billing.economics.failed', 'billing.economics.snapshot_failed'],
        ],
        captured: [
          ['billing.economics.snapshot_failed', 'INFRASTRUCTURE', true],
        ],
      },
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a reporter that fails mid-batch retries only the signals it did not submit', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'billing-economics-worker-'));
  let calls = 0;
  try {
    const run = await runWorker({
      directory,
      ticks: 2,
      capture: () => {
        if (++calls === 2) throw new Error('private adapter');
      },
    });
    assert({
      given:
        'a reporter that throws on its second capture, while three completeness signals are owed',
      should:
        'capture each plan exactly once across the retry, never duplicating a submitted signal',
      actual: run.captured
        .filter((c) => c.errorCode === 'BILLING_ECONOMICS_INCOMPLETE')
        .map((c) => c.route),
      expected: [
        'billing.economics.free',
        'billing.economics.beta',
        'billing.economics.premium',
      ],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('report signals are raised once a month, a returning failure after each recovery', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'billing-economics-worker-'));
  try {
    const run = await runWorker({
      directory,
      ticks: 4,
      between: async (n) => {
        if (n === 1 || n === 3) await chmod(directory, 0o755);
        if (n === 2 || n === 4) await chmod(directory, 0o700);
      },
    });
    assert({
      given:
        'feed missing, sink unavailable, feed missing, sink unavailable, feed missing',
      should:
        'raise the completeness signals once a month, and the sink failure each time it returns after a report settled',
      actual: run.captured.map((c) => c.route),
      expected: [
        'billing.economics.free',
        'billing.economics.beta',
        'billing.economics.premium',
        'billing.economics.sink_unavailable',
        'billing.economics.sink_unavailable',
      ],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a reporter that keeps throwing is reported as signal_failed once, and retried quietly', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'billing-economics-worker-'));
  try {
    const run = await runWorker({
      directory,
      ticks: 3,
      capture: (_error, context) => {
        if (context.errorCode === 'BILLING_ECONOMICS_INCOMPLETE')
          throw new Error('private adapter');
      },
    });
    assert({
      given:
        'a reporter that throws on every signal capture over four collections',
      should:
        'log feed_missing once and signal_failed once, not every hour, with a typed INFRASTRUCTURE capture carrying the cause',
      actual: {
        logged: run.logged.map((line) => [line.event, line.fields.operation]),
        captured: run.captured
          .filter((c) => c.route === 'billing.economics.signal_failed')
          .map((c) => [
            c.errorCode,
            c.error instanceof Error &&
              c.error.cause instanceof Error &&
              c.error.cause.message,
          ]),
      },
      expected: {
        logged: [
          ['billing.economics.feed_missing', 'billing.economics.collect'],
          ['billing.economics.failed', 'billing.economics.signal_failed'],
        ],
        captured: [['INFRASTRUCTURE', 'private adapter']],
      },
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a failure that returns after a recovery is raised again', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'billing-economics-worker-'));
  try {
    await fillSink(directory);
    const run = await runWorker({
      directory,
      ticks: 3,
      between: async (n) => {
        if (n === 1) await drainSink(directory);
        if (n === 2) await fillSink(directory);
      },
    });
    assert({
      given:
        'a sink that refuses the save, then saves, then refuses again for two ticks',
      should:
        'raise save_failed, then the signals, then save_failed once more as a regression',
      actual: run.captured.map((c) => c.route),
      expected: [
        'billing.economics.save_failed',
        'billing.economics.free',
        'billing.economics.beta',
        'billing.economics.premium',
        'billing.economics.save_failed',
      ],
    });
  } finally {
    await chmod(directory, 0o700);
    await rm(directory, { recursive: true, force: true });
  }
});

test('a throwing logger after submission never makes the next tick re-send signals', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'billing-economics-worker-'));
  try {
    const run = await runWorker({
      directory,
      ticks: 2,
      logThrows: (event) => event === 'billing.economics.feed_missing',
    });
    assert({
      given:
        'a logger that throws when feed_missing is logged, over three collections',
      should: 'still capture each completeness signal exactly once',
      actual: run.captured
        .filter((c) => c.errorCode === 'BILLING_ECONOMICS_INCOMPLETE')
        .map((c) => c.route),
      expected: [
        'billing.economics.free',
        'billing.economics.beta',
        'billing.economics.premium',
      ],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('in a month that starts healthy, every regression after a report is raised', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'billing-economics-worker-'));
  try {
    const run = await runWorker({
      directory,
      ticks: 4,
      between: async (n) => {
        if (n === 1 || n === 3) await fillSink(directory);
        if (n === 2) await drainSink(directory);
      },
    });
    assert({
      given:
        'a report, a refused save, a report, then two refused saves (five collections)',
      should:
        'raise the signals once and save_failed after each recovery, once per regression',
      actual: run.captured.map((c) => c.route),
      expected: [
        'billing.economics.free',
        'billing.economics.beta',
        'billing.economics.premium',
        'billing.economics.save_failed',
        'billing.economics.save_failed',
      ],
    });
  } finally {
    await chmod(directory, 0o700);
    await rm(directory, { recursive: true, force: true });
  }
});

test('a failure neither sink took is retried on the next tick, then settled', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'billing-economics-worker-'));
  let logs = 0,
    captures = 0;
  try {
    await chmod(directory, 0o755);
    const run = await runWorker({
      directory,
      ticks: 2,
      logThrows: (event) =>
        event === 'billing.economics.failed' && ++logs === 1,
      capture: () => {
        if (++captures === 1) throw new Error('reporter');
      },
    });
    assert({
      given:
        'a sink failure whose first log line and first capture both throw, over three collections',
      should:
        'retry it on the next tick, where it is recorded, and then raise it no more',
      actual: {
        attempts: run.logged.filter(
          (line) => line.event === 'billing.economics.failed',
        ).length,
        captured: run.captured.map((c) => c.route),
      },
      expected: {
        attempts: 2,
        captured: ['billing.economics.sink_unavailable'],
      },
    });
  } finally {
    await chmod(directory, 0o700);
    await rm(directory, { recursive: true, force: true });
  }
});

test('invalid data is captured as VALIDATION, an unavailable resource as INFRASTRUCTURE', async () => {
  const codes = async (
    prepare: (directory: string) => Promise<void>,
    snapshot?: (period: { startsAt: string; endsAt: string }) => unknown,
  ) => {
    const directory = await mkdtemp(
      join(tmpdir(), 'billing-economics-worker-'),
    );
    try {
      await prepare(directory);
      const run = await runWorker({
        directory,
        ticks: 0,
        ...(snapshot ? { snapshot } : {}),
      });
      return run.captured.map((c) => [c.route, c.errorCode]);
    } finally {
      await chmod(directory, 0o700);
      await rm(directory, { recursive: true, force: true });
    }
  };
  const feedFile = (directory: string, body: string) =>
    writeFile(join(directory, 'feed-2026-10.json'), body, { mode: 0o600 });
  assert({
    given:
      'a snapshot for another window, a feed stating a 10% floor, a truncated feed file, a non-private sink, a feed with repeated revenue sequences, and a feed over 1 MiB',
    should:
      'capture each misconfiguration or bad datum as VALIDATION, a non-private sink included',
    actual: [
      await codes(
        async () => undefined,
        (period) => ({
          ...period,
          startsAt: '2026-09-01T00:00:00.000Z',
          observedAt: now,
          attempts: [],
          usage: [],
          complete: true,
        }),
      ),
      await codes((directory) => {
        const { modelUsage: _m, ...financial } = dataset();
        void _m;
        return feedFile(
          directory,
          JSON.stringify({
            ...financial,
            modelCostBasis: 'provider_invoice',
            floorBasisPoints: 1000,
          }),
        );
      }),
      await codes((directory) => feedFile(directory, '{"startsAt":')),
      await codes((directory) => chmod(directory, 0o755)),
      await codes((directory) => {
        const { modelUsage: _m, ...financial } = dataset();
        void _m;
        return feedFile(
          directory,
          JSON.stringify({
            ...financial,
            modelCostBasis: 'provider_invoice',
            revenue: [...financial.revenue, ...financial.revenue],
          }),
        );
      }),
      await codes((directory) =>
        feedFile(directory, `"${'x'.repeat(1024 * 1024 + 1)}"`),
      ),
    ],
    expected: [
      [['billing.economics.snapshot_invalid', 'VALIDATION']],
      [['billing.economics.feed_invalid', 'VALIDATION']],
      [['billing.economics.feed_invalid', 'VALIDATION']],
      [['billing.economics.sink_unavailable', 'VALIDATION']],
      [['billing.economics.report_invalid', 'VALIDATION']],
      [['billing.economics.feed_invalid', 'VALIDATION']],
    ],
  });
});

test('a changed report never re-sends a signal already raised that month', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'billing-economics-worker-'));
  const { modelUsage: _m, ...financial } = dataset();
  void _m;
  try {
    const run = await runWorker({
      directory,
      ticks: 1,
      between: async () => {
        await writeFile(
          join(directory, 'feed-2026-10.json'),
          JSON.stringify({ ...financial, modelCostBasis: 'provider_invoice' }),
          { mode: 0o600 },
        );
      },
    });
    assert({
      given:
        'a missing feed (incomplete for every plan), then a supplied feed leaving free and beta incomplete and premium below the floor',
      should:
        'raise each incomplete plan once and add only the new low-margin signal',
      actual: run.captured.map((c) => [c.errorCode, c.route]),
      expected: [
        ['BILLING_ECONOMICS_INCOMPLETE', 'billing.economics.free'],
        ['BILLING_ECONOMICS_INCOMPLETE', 'billing.economics.beta'],
        ['BILLING_ECONOMICS_INCOMPLETE', 'billing.economics.premium'],
        ['BILLING_LOW_MARGIN', 'billing.economics.premium'],
      ],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a different problem in the same stage is raised, the same problem is not', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'billing-economics-worker-'));
  try {
    const run = await runWorker({
      directory,
      ticks: 10,
      refuse: (read) =>
        read <= 9 ? refuseCapacity() : new Error('Economics database down'),
    });
    assert({
      given:
        'nine capacity refusals on the snapshot read (escalated at the bound), then a database outage, over eleven collections',
      should:
        'report the starved stage once and the outage once, as distinct notices',
      actual: run.captured.map((c) => [c.route, c.errorCode]),
      expected: [
        ['billing.economics.snapshot_failed.capacity', 'INFRASTRUCTURE'],
        ['billing.economics.snapshot_failed', 'INFRASTRUCTURE'],
      ],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a throwing feed_missing log is never a collection failure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'billing-economics-worker-'));
  try {
    const run = await runWorker({
      directory,
      ticks: 1,
      logThrows: (event) => event === 'billing.economics.feed_missing',
    });
    assert({
      given: 'a logger that throws on billing.economics.feed_missing',
      should: 'raise no billing.economics.collect failure for a saved report',
      actual: run.captured.filter(
        (c) => c.route === 'billing.economics.collect',
      ).length,
      expected: 0,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a capacity refusal never masks a later outage, nor stops counting once an outage was raised', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'billing-economics-worker-'));
  const outage = () =>
    createAppError('INFRASTRUCTURE', 'Transaction backend unavailable');
  try {
    const run = await runWorker({
      directory,
      ticks: 10,
      refuse: (read) => (read === 1 ? outage() : refuseCapacity()),
    });
    assert({
      given:
        'a typed INFRASTRUCTURE outage on the snapshot read, then ten capacity refusals (eleven collections)',
      should:
        'report the outage once and still escalate the starved stage at the shared bound',
      actual: run.captured.map((c) => c.route),
      expected: [
        'billing.economics.snapshot_failed',
        'billing.economics.snapshot_failed.capacity',
      ],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a regression after a saved report is raised even while signals are failing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'billing-economics-worker-'));
  const outage = new Error('Economics snapshot unavailable');
  try {
    const run = await runWorker({
      directory,
      ticks: 2,
      refuse: (read) => (read === 2 ? undefined : outage),
      capture: (_error, context) => {
        if (context.errorCode === 'BILLING_ECONOMICS_INCOMPLETE')
          throw new Error('private adapter');
      },
    });
    assert({
      given:
        'a snapshot outage, then a saved report whose signals fail, then the outage again',
      should: 'raise the outage both times and the signal failure once',
      actual: run.captured.map((c) => c.route),
      expected: [
        'billing.economics.snapshot_failed',
        'billing.economics.signal_failed',
        'billing.economics.snapshot_failed',
      ],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a feed_missing line the log sink refused is written on a later tick', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'billing-economics-worker-'));
  let attempts = 0;
  try {
    const run = await runWorker({
      directory,
      ticks: 2,
      logThrows: (event) =>
        event === 'billing.economics.feed_missing' && ++attempts === 1,
    });
    assert({
      given:
        'a log sink that throws the first time feed_missing is logged, over three collections',
      should: 'try again on the next tick, then log it no more',
      actual: run.logged.filter(
        (l) => l.event === 'billing.economics.feed_missing',
      ).length,
      expected: 2,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a failure outside any collection is reported once, not every hour', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'billing-economics-worker-'));
  const app = build(directory);
  const { logged, logger } = createEventRecorder();
  let tick: (() => Promise<void>) | null = null;
  const service = startBillingEconomics({
    app: {
      ...app,
      logger,
      clock: { now: () => 'not an instant' },
      database: { ...app.database, billingEconomics: snapshotStore() },
    },
    instanceId: 'service-fixture',
    timers: {
      setInterval: (run) => {
        tick = run;
        return 1;
      },
      clearInterval: () => undefined,
    },
  });
  try {
    await service.started;
    for (let n = 0; n < 3; n++)
      await (tick as (() => Promise<void>) | null)?.();
    assert({
      given: 'a clock that never yields an instant, over four ticks',
      should: 'log billing.economics.collect once',
      actual: logged
        .filter((line) => line.event === 'billing.economics.failed')
        .map((line) => line.fields.operation),
      expected: ['billing.economics.collect'],
    });
  } finally {
    await service.stop();
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('each failed check is named on its log line', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'billing-economics-worker-'));
  const { modelUsage: _m, ...financial } = dataset();
  void _m;
  const feedFile = (value: unknown) =>
    writeFile(join(directory, 'feed-2026-10.json'), JSON.stringify(value), {
      mode: 0o600,
    });
  try {
    await feedFile({
      ...financial,
      modelCostBasis: 'provider_invoice',
      startsAt: '2026-09-01T00:00:00.000Z',
    });
    const run = await runWorker({
      directory,
      ticks: 1,
      between: () =>
        feedFile({ ...financial, modelCostBasis: 'usage_counters' }),
    });
    assert({
      given:
        'a feed for the wrong window, then a feed with conflicting cost bases',
      should: 'log two feed_invalid lines, each naming its own check',
      actual: run.logged
        .filter((line) => line.event === 'billing.economics.failed')
        .map((line) => [line.fields.operation, line.fields.cause]),
      expected: [
        ['billing.economics.feed_invalid', 'economics-feed-window-mismatch'],
        ['billing.economics.feed_invalid', 'economics-feed-conflicting-basis'],
      ],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('the log line names a check by its closed reason, never its message', () => {
  const check = createRefusal(
    'VALIDATION',
    'economics-feed-conflicting-basis',
    'Any wording at all',
  );
  assert({
    given:
      'a stage error wrapping a reasoned check, a reasoned error with no cause, a stage error wrapping an untyped error, a typed error with no reason, and an untyped error',
    should:
      'name the check, then the error itself, then the stage, and nothing where no reason exists',
    actual: [
      economicsFailureCheck(
        createRefusal('VALIDATION', 'economics-feed-invalid', 'x', check),
      ),
      economicsFailureCheck(check),
      economicsFailureCheck(
        createRefusal(
          'INFRASTRUCTURE',
          'economics-snapshot-failed',
          'x',
          new Error('driver'),
        ),
      ),
      economicsFailureCheck(createAppError('INFRASTRUCTURE', 'no reason')),
      economicsFailureCheck(new Error('driver')),
    ],
    expected: [
      'economics-feed-conflicting-basis',
      'economics-feed-conflicting-basis',
      'economics-snapshot-failed',
      undefined,
      undefined,
    ],
  });
});

test('a feed that disappears after being supplied is logged as missing again', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'billing-economics-worker-'));
  const path = join(directory, 'feed-2026-10.json');
  const { modelUsage: _m, ...financial } = dataset();
  void _m;
  try {
    const run = await runWorker({
      directory,
      ticks: 2,
      between: async (n) => {
        if (n === 1)
          await writeFile(
            path,
            JSON.stringify({
              ...financial,
              modelCostBasis: 'provider_invoice',
            }),
            { mode: 0o600 },
          );
        if (n === 2) await rm(path);
      },
    });
    assert({
      given: 'a missing feed, then a supplied feed, then the feed removed',
      should:
        'log feed_missing for the first absence and again after the removal',
      actual: run.logged.filter(
        (l) => l.event === 'billing.economics.feed_missing',
      ).length,
      expected: 2,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('captures carry a fixed per-stage message, and signal_failed keeps a typed code', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'billing-economics-worker-'));
  try {
    const stage = await runWorker({
      directory,
      ticks: 0,
      refuse: () => new Error('driver down'),
    });
    const signals = await runWorker({
      directory,
      ticks: 0,
      capture: (_error, context) => {
        if (context.errorCode === 'BILLING_ECONOMICS_INCOMPLETE')
          throw createAppError('VALIDATION', 'Scrubber refused the context');
      },
    });
    const messageOf = (c: { error: unknown }) =>
      c.error instanceof Error ? c.error.message : null;
    assert({
      given:
        'a snapshot read that throws, then a reporter that throws a typed VALIDATION error',
      should:
        'capture "Billing economics snapshot_failed", and signal_failed as "Billing economics signal_failed" under VALIDATION',
      actual: [
        stage.captured.map((c) => [c.route, messageOf(c)]),
        signals.captured
          .filter((c) => c.route === 'billing.economics.signal_failed')
          .map((c) => [c.errorCode, messageOf(c)]),
        stage.captured.map((c) => economicsFailureCheck(c.error)),
      ],
      expected: [
        [
          [
            'billing.economics.snapshot_failed',
            'Billing economics snapshot_failed',
          ],
        ],
        [['VALIDATION', 'Billing economics signal_failed']],
        ['economics-snapshot-failed'],
      ],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('two different defects outside any collection are each reported', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'billing-economics-worker-'));
  const app = build(directory);
  const { logged, logger } = createEventRecorder();
  let calls = 0;
  let tick: (() => Promise<void>) | null = null;
  const service = startBillingEconomics({
    app: {
      ...app,
      logger,
      clock: {
        now: () => {
          calls++;
          if (calls <= 2) throw new TypeError('defect A');
          throw new RangeError('defect B');
        },
      },
      database: { ...app.database, billingEconomics: snapshotStore() },
    },
    instanceId: 'service-fixture',
    timers: {
      setInterval: (run) => {
        tick = run;
        return 1;
      },
      clearInterval: () => undefined,
    },
  });
  try {
    await service.started;
    for (let n = 0; n < 3; n++)
      await (tick as (() => Promise<void>) | null)?.();
    assert({
      given:
        'a TypeError on the first two ticks, then a RangeError on the next two',
      should: 'report each defect once, each line naming the collect stage',
      actual: logged
        .filter((line) => line.event === 'billing.economics.failed')
        .map((line) => line.fields.cause),
      expected: ['economics-collect-failed', 'economics-collect-failed'],
    });
  } finally {
    await service.stop();
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('a reporter that throws for everything logs signal_failed once', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'billing-economics-worker-'));
  try {
    const run = await runWorker({
      directory,
      ticks: 3,
      capture: () => {
        throw new Error('tracker down');
      },
    });
    assert({
      given:
        'a reporter that throws on every capture, the failure report included, over four collections',
      should:
        'log signal_failed once, since the log line is the only channel left',
      actual: run.logged
        .filter((line) => line.event === 'billing.economics.failed')
        .map((line) => line.fields.operation),
      expected: ['billing.economics.signal_failed'],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('the log line names the innermost reason in the cause chain', () => {
  const privacy = createRefusal('VALIDATION', 'economics-sink-not-private');
  const reader = createRefusal(
    'INFRASTRUCTURE',
    'economics-sink-unreadable',
    undefined,
    privacy,
  );
  assert({
    given:
      'a stage error wrapping the feed reader refusal, which wraps the directory privacy refusal',
    should: 'name the privacy refusal, the actual fault',
    actual: economicsFailureCheck(
      createRefusal(
        'INFRASTRUCTURE',
        'economics-feed-unreadable',
        undefined,
        reader,
      ),
    ),
    expected: 'economics-sink-not-private',
  });
});

test('alternating failures outside any collection are each reported once', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'billing-economics-worker-'));
  const app = build(directory);
  const { logged, logger } = createEventRecorder();
  let calls = 0;
  let tick: (() => Promise<void>) | null = null;
  const service = startBillingEconomics({
    app: {
      ...app,
      logger,
      clock: {
        now: () => {
          calls++;
          if (calls % 2 === 1) return 'not an instant';
          throw new TypeError('defect');
        },
      },
      database: { ...app.database, billingEconomics: snapshotStore() },
    },
    instanceId: 'service-fixture',
    timers: {
      setInterval: (run) => {
        tick = run;
        return 1;
      },
      clearInterval: () => undefined,
    },
  });
  try {
    await service.started;
    for (let n = 0; n < 5; n++)
      await (tick as (() => Promise<void>) | null)?.();
    assert({
      given:
        'an invalid clock and an untyped defect alternating over six ticks',
      should: 'report each problem once',
      actual: logged
        .filter((line) => line.event === 'billing.economics.failed')
        .map((line) => line.fields.cause),
      expected: ['economics-clock-invalid', 'economics-collect-failed'],
    });
  } finally {
    await service.stop();
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('a hostile error outside any collection never rejects the worker', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'billing-economics-worker-'));
  const app = build(directory);
  const hostile = new Error('hostile');
  Object.defineProperty(hostile, 'code', {
    get() {
      throw new Error('getter');
    },
  });
  const service = startBillingEconomics({
    app: {
      ...app,
      logger: createEventRecorder().logger,
      clock: {
        now: () => {
          throw hostile;
        },
      },
      database: { ...app.database, billingEconomics: snapshotStore() },
    },
    instanceId: 'service-fixture',
    timers: { setInterval: () => 1, clearInterval: () => undefined },
  });
  try {
    assert({
      given: 'an error whose code getter throws',
      should: 'settle the tick without rejecting',
      actual: await service.started.then(
        () => 'settled',
        () => 'rejected',
      ),
      expected: 'settled',
    });
  } finally {
    await service.stop();
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('a hostile cause in a stage still reports that stage', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'billing-economics-worker-'));
  const hostile = new Error('hostile');
  Object.defineProperty(hostile, 'code', {
    get() {
      throw new Error('getter');
    },
  });
  try {
    const run = await runWorker({ directory, ticks: 2, refuse: () => hostile });
    assert({
      given:
        'a snapshot read that throws an error whose code getter throws, over three collections',
      should: 'report snapshot_failed once, never collect',
      actual: run.logged
        .filter((line) => line.event === 'billing.economics.failed')
        .map((line) => line.fields.operation),
      expected: ['billing.economics.snapshot_failed'],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
