import { mkdtemp, writeFile, readdir, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { fixedClock } from '@daisy/clock';
import { createId } from '@paralleldrive/cuid2';
import { createApp } from './app';
import { silentLogger } from './test-loggers.test-support';
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

test('the actual scheduler reads its current-service monthly port and refuses missing measurements', async () => {
  const app = build(),
    reads: unknown[] = [],
    signals: string[] = [];
  let tick: () => Promise<void> = async () => undefined;
  let cadence = 0,
    cleared = false;
  const service = startBillingEconomics({
    app: {
      ...app,
      database: {
        ...app.database,
        billingEconomics: (instanceId) => ({
          read: async (period) => {
            reads.push({ instanceId, ...period });
            return {
              ...period,
              observedAt: now,
              attempts: [],
              usage: [],
              complete: true,
            };
          },
        }),
      },
      reporter: {
        capture: (_error, context) => {
          signals.push(context.errorCode);
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
      clearInterval: () => {
        cleared = true;
      },
    },
  });
  try {
    await service.started;
    await service.stop();
    await tick();
    assert({
      given:
        'a beta process without Stripe or a private financial feed, using controlled source/reporter ports',
      should:
        'read the selected original calendar window, signal incompleteness and stop scheduling without claiming measured cost',
      actual: {
        reads,
        cadence,
        cleared,
        incomplete: signals.includes('BILLING_ECONOMICS_INCOMPLETE'),
        low: signals.includes('BILLING_LOW_MARGIN'),
      },
      expected: {
        reads: [{ instanceId: 'service-fixture', ...window }],
        cadence: 3_600_000,
        cleared: true,
        incomplete: true,
        low: false,
      },
    });
  } finally {
    await service.stop();
    await app.close();
  }
});

test('the composed private-file collector uses the recorded floor and cannot accept a supplier override', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'billing-economics-runtime-'));
  const app = build(directory),
    signals: string[] = [];
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
        reporter: {
          capture: (_error, context) => {
            signals.push(context.errorCode);
          },
        },
      },
      'service-fixture',
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
        'save one private report and submit the named low-margin signal while refusing the override as incomplete',
      actual: {
        crossing: crossing.kind,
        delivery: crossing.kind === 'reported' && crossing.alertDelivery,
        override: override.kind,
        low: signals.filter((code) => code === 'BILLING_LOW_MARGIN').length,
        incomplete: signals.includes('BILLING_ECONOMICS_INCOMPLETE'),
        reports: reports.length,
        mode: reports[0]
          ? (await stat(join(directory, reports[0]))).mode & 0o777
          : null,
      },
      expected: {
        crossing: 'reported',
        delivery: 'unconfirmed',
        override: 'failed',
        low: 1,
        incomplete: true,
        reports: 1,
        mode: 0o600,
      },
    });
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
