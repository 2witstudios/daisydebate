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
        logged: [['billing.economics.feed_missing', 'economics-feed-missing']],
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
        'capture one typed error carrying the caught error as feed_unreadable (VALIDATION: the directory is misconfigured), then raise the new feed-missing outcome',
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
            'billing.economics.feed_unreadable',
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
          ['billing.economics.failed', 'billing.economics.feed_unreadable'],
          ['billing.economics.feed_missing', 'billing.economics.collect'],
        ],
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

test('a reporter that keeps throwing is reported as report_failed once, and retried quietly', async () => {
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
        'log feed_missing once and report_failed once, not every hour, with a capture carrying the cause',
      actual: {
        logged: run.logged.map((line) => [line.event, line.fields.operation]),
        captured: run.captured
          .filter((c) => c.route === 'billing.economics.report_failed')
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
          ['billing.economics.failed', 'billing.economics.report_failed'],
        ],
        captured: [['INTERNAL', 'private adapter']],
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
        'raise the full sink, then the signals, then the full sink once more as a regression',
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

test("a lapsed service lease is the sink's warning, never a captured stage failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), 'billing-economics-worker-'));
  try {
    const run = await runWorker({
      directory,
      ticks: 1,
      refuse: () =>
        createRefusal(
          'AUTHORIZATION',
          'service-lease-lapsed',
          'Web service is not current',
        ),
    });
    assert({
      given:
        "a snapshot read refused because this instance's lease lapsed, on two ticks",
      should:
        'log the service.lease_lapsed warning and capture nothing (DAISY-WEB-9)',
      actual: {
        events: [...new Set(run.logged.map((line) => line.event))],
        captured: run.captured.length,
      },
      expected: { events: ['service.lease_lapsed'], captured: 0 },
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
