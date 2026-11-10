import { chmod, mkdtemp, writeFile, readdir, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { fixedClock } from '@daisy/clock';
import { createId } from '@paralleldrive/cuid2';
import { refuseCapacity } from '@daisy/db/testing';
import { createApp } from './app';
import { createEventRecorder, silentLogger } from './test-loggers.test-support';
import {
  composeBillingEconomics,
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
}) {
  const app = build(input.directory),
    reads: unknown[] = [],
    captured: Captured[] = [];
  const { logged, logger } = createEventRecorder();
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
        'a provisioned private sink with no feed for the previous month, over three hourly ticks',
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
        'capture one typed INFRASTRUCTURE error carrying the caught error as sink_unavailable, then raise the new feed-missing outcome',
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
            'INFRASTRUCTURE',
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
        'log billing.economics.failed as signal_failed, then raise the signals and log feed_missing once on the next tick',
      actual: {
        logged: run.logged.map((line) => [line.event, line.fields.operation]),
        incomplete: run.captured.filter(
          (c) => c.errorCode === 'BILLING_ECONOMICS_INCOMPLETE',
        ).length,
      },
      expected: {
        logged: [
          ['billing.economics.failed', 'billing.economics.signal_failed'],
          ['billing.economics.feed_missing', 'billing.economics.collect'],
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

test('an outcome that returns after another is not raised again that month', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'billing-economics-worker-'));
  try {
    const run = await runWorker({
      directory,
      ticks: 3,
      between: async (n) => {
        if (n === 1) await chmod(directory, 0o755);
        if (n === 2) await chmod(directory, 0o700);
      },
    });
    assert({
      given:
        'feed missing, then the sink unavailable, then feed missing again, then unavailable again',
      should:
        'raise the completeness signals once and the sink failure once for the month',
      actual: run.captured.map((c) => c.route),
      expected: [
        'billing.economics.free',
        'billing.economics.beta',
        'billing.economics.premium',
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
      given: 'a reporter that throws on every signal capture over four ticks',
      should:
        'log billing.economics.failed as signal_failed once, not every hour',
      actual: run.logged.map((line) => [line.event, line.fields.operation]),
      expected: [
        ['billing.economics.failed', 'billing.economics.signal_failed'],
      ],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
