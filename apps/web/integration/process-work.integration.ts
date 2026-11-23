import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { systemClock, systemId } from '@daisy/clock';
import { requireTestServices } from '@daisy/config';
import { hostWaits } from '@daisy/worker/host';
import { setDefaultTimeout } from 'bun:test';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { authTestEnv } from '../src/features/auth/auth-server.test-support';
import { createApp } from '../src/server/app';
import { startProcessWork } from '../src/server/process-work';
import { createBoundedTestClient, testNamespace } from '@daisy/redis/testing';
import { messagingFileProofRuntime } from './messaging-file-runtime.test-support';

setupRitewayBun();
setDefaultTimeout(60_000);

const { databaseUrl, redisUrl } = requireTestServices(process.env);

/**
 * The worker net (RECON-4.6): which background work a started production
 * process runs, by name, under each configuration that changes the set.
 * It must read the same before and after the work moves into its features.
 */
const media = {
  LIVEKIT_URL: 'http://127.0.0.1:9',
  LIVEKIT_PUBLIC_URL: 'wss://media.invalid',
  LIVEKIT_API_KEY: 'process-work-key',
  LIVEKIT_API_SECRET: 'process-work-secret-process-work-secret',
};
const billing = {
  STRIPE_SECRET_KEY: 'sk_test_processwork',
  STRIPE_WEBHOOK_SECRET: 'whsec_processwork',
  STRIPE_PREMIUM_PRICE_ID: 'price_processwork',
  STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_processwork',
};

type Variant = {
  readonly env?: Readonly<Record<string, string>>;
  readonly files?: boolean;
};

const startedAt = new Date().toISOString();

const startedWork = async ({ env = {}, files = false }: Variant) => {
  const directory = await mkdtemp(join(tmpdir(), 'daisy-process-work-'));
  const app = createApp({
    waits: hostWaits,
    env: {
      ...authTestEnv,
      DATABASE_URL: databaseUrl,
      REDIS_URL: redisUrl,
      REDIS_NAMESPACE: testNamespace(createId()),
      LOG_LEVEL: 'silent',
      ...env,
    },
    fetch: async () => new Response(null, { status: 503 }),
    clock: systemClock,
    ids: systemId,
    redisClient: createBoundedTestClient(redisUrl),
    ...(files
      ? {
          messagingFiles: {
            ...messagingFileProofRuntime(directory, 9),
            maintenance: { intervalMs: 60_000, maxItems: 10 },
          },
        }
      : {}),
  });
  const { workers, running, instanceId } = await startProcessWork({
    app,
    waits: hostWaits,
    vendorFetch: Object.assign(
      async () => new Response(null, { status: 503 }),
      { preconnect: () => undefined },
    ),
    probeFetch: async () => new Response(null, { status: 503 }),
  });
  await Promise.all(workers.map((worker) => worker.stop()));
  await app.close();
  // The availability worker registers its instance and samples health.
  const sql = new SQL(databaseUrl);
  await sql`delete from service_instances where instance_id=${instanceId}`;
  await sql`delete from availability_samples where at>=${startedAt}::timestamptz`;
  await sql.close();
  return [...running].sort();
};

const always = [
  'availability',
  'betaMail',
  'billingCleanup',
  'billingEconomics',
  'laneGauges',
  'mediaReleaseMail',
  'notificationMail',
  'notificationSweep',
  'observationPurges',
  'photoDeletions',
  'privacyJobs',
  'recordingDeletions',
  'retention',
  'roomMaintenance',
  'roundMaintenance',
  'roundMedia',
  'stageMedia',
  'usageRecovery',
  'workWakes',
];
const plus = (...names: string[]) => [...always, ...names].sort();

test('the background work a production process runs, by configuration', async () => {
  const variants = {
    unconfigured: await startedWork({}),
    media: await startedWork({ env: media }),
    billing: await startedWork({ env: billing }),
    files: await startedWork({ files: true }),
    broadcast: await startedWork({
      env: { ...media, BROADCAST_CAPTURE: 'on' },
    }),
  };
  assert({
    given: 'a process started with each optional capability alone',
    should: 'run the same named background work as before RECON-4.6',
    actual: variants,
    expected: {
      unconfigured: plus(),
      media: plus('mediaRecovery', 'mediaRuntime'),
      billing: plus(
        'billingPurchases',
        'billingRefunds',
        'billingSubscriptions',
      ),
      files: plus('fileMaintenance'),
      broadcast: plus(
        'broadcastSweep',
        'mediaRecovery',
        'mediaRuntime',
        'strayEgressSweep',
      ),
    },
  });
});
