import { SQL } from 'bun';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices, type BillingConfig } from '@daisy/config';
import { createDatabase } from '@daisy/db';
import { systemClock } from '@daisy/clock';
import { createId } from '@paralleldrive/cuid2';
import type { Logger } from '@daisy/logger';
import { createApp } from '../src/server/app';
import { startBillingCleanup } from '../src/server/billing-cleanup';
import { authTestEnv } from '../src/features/auth/auth-server.test-support';
import { betaMessagingPolicy } from '../src/features/messaging/beta-policy';
import type { BillingFetch } from '../src/server/billing-stripe';
const { databaseUrl } = requireTestServices(process.env);
setupRitewayBun();
const configured: BillingConfig = {
  kind: 'stripe',
  mode: 'test',
  secretKey: 'sk_test_fixture',
  webhookSecret: 'whsec_fixture',
  premiumPriceId: 'price_replacement',
  portalConfigurationId: 'bpc_fixture',
};

for (const mapped of [false, true])
  test(`actual scheduled Stripe branch completes ${mapped ? 'owned empty-customer traversal' : 'keyless positively empty closure'} without generic erasure`, async () => {
    const owner = new SQL(databaseUrl, { max: 1 }),
      pool = new SQL(databaseUrl, { max: 4 });
    const userId = createId(),
      actorId = createId(),
      customerRecord = createId(),
      customerId = `cus_${customerRecord}`,
      jobId = createId(),
      otherJob = createId(),
      instanceId = createId();
    const roles = new Set<string>(),
      logs: { event: string; fields: Readonly<Record<string, unknown>> }[] = [],
      failures: unknown[] = [],
      requests: { method: string; path: string; version: string | null }[] = [];
    const reserve = pool.reserve.bind(pool);
    pool.reserve = async (options) => {
      const connection = await reserve(options);
      await connection`set role daisy_web`;
      const [row] = await connection`select current_user as role`;
      roles.add(row!.role);
      return connection;
    };
    const database = createDatabase({
      url: databaseUrl,
      client: pool,
      nextActorId: createId,
    });
    const ticks = new Map<number, () => Promise<void>>(),
      cleared: unknown[] = [];
    let service: ReturnType<typeof startBillingCleanup> | undefined;
    const transport: BillingFetch = Object.assign(
      async (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) => {
        if (!mapped)
          throw Error('Keyless closure attempted external transport');
        const url = new URL(String(input)),
          method = init?.method ?? 'GET';
        requests.push({
          method,
          path: url.pathname,
          version: new Headers(init?.headers).get('Stripe-Version'),
        });
        if (
          method === 'GET' &&
          (url.pathname === '/v1/subscriptions' ||
            url.pathname === '/v1/invoices')
        ) {
          if (
            url.searchParams.get('customer') !== customerId ||
            url.searchParams.get('limit') !== '20'
          )
            throw Error('Unbounded or foreign vendor page');
          return Response.json({ object: 'list', data: [], has_more: false });
        }
        if (method === 'GET' && url.pathname === `/v1/customers/${customerId}`)
          return Response.json({
            object: 'customer',
            id: customerId,
            livemode: false,
          });
        if (
          method === 'DELETE' &&
          url.pathname === `/v1/customers/${customerId}`
        )
          return Response.json({
            object: 'customer',
            id: customerId,
            deleted: true,
          });
        throw Error('Unexpected controlled Stripe request');
      },
      { preconnect() {} },
    );
    const logger: Logger = {
      log: (event, fields) => logs.push({ event, fields }),
      child: () => logger,
    };
    try {
      const [clock] =
        await owner`select date_trunc('milliseconds',clock_timestamp()) as at`;
      const created = new Date(clock!.at.getTime() - 60_000),
        closed = new Date(clock!.at.getTime() - 2_000);
      // Explicit closed-account adapter fixture, not a claim of native closure or genuine vendor execution.
      await owner`insert into users(id,username,created_at,deleted_at) values(${userId},${userId},${created},${closed})`;
      await owner`insert into actors(id,kind,user_id) values(${actorId},'human',${userId})`;
      if (mapped)
        await owner`insert into billing_customers(id,user_id,vendor_customer_id,mode,created_at,closed_at,synchronization)
    values(${customerRecord},${userId},${customerId},'test',${created},${closed},${JSON.stringify({ kind: 'settled', revision: 1, observedAt: clock!.at.toISOString(), nextAt: clock!.at.toISOString() })}::text::jsonb)`;
      await owner`insert into privacy_jobs(id,subject_ref,vendor,created_at,retry_at) values(${jobId},${userId},'stripe',${clock!.at},${clock!.at}),(${otherJob},${userId},'posthog',${clock!.at},${clock!.at})`;
      await database.renewServiceInstance({ instanceId, role: 'web' });
      const app = createApp({
        env: {
          ...authTestEnv,
          DATABASE_URL: databaseUrl,
          REDIS_URL: 'redis://localhost:6379',
          REDIS_NAMESPACE: 'billing-cleanup-runtime',
          LOG_LEVEL: 'silent',
        },
        messagingPolicy: betaMessagingPolicy,
        clock: systemClock,
        ids: { next: createId },
        fetch: async () => {
          throw Error('Unexpected application network');
        },
      });
      service = startBillingCleanup({
        app: {
          ...app,
          config: {
            ...app.config,
            billing: mapped ? configured : { kind: 'disabled' },
          },
          database,
          logger,
          reporter: {
            capture: (error, context) => failures.push({ error, context }),
          },
        },
        instanceId,
        timers: {
          setInterval: (task, ms) => {
            ticks.set(ms, task);
            return ms;
          },
          clearInterval: (handle) => {
            cleared.push(handle);
          },
        },
        fetch: transport,
      });
      await service.started;
      for (let step = 0; step < 8; step++) {
        const [job] =
          await owner`select status,retry_at from privacy_jobs where id=${jobId}`;
        if (job!.status === 'succeeded') break;
        const [clock] = await owner`select clock_timestamp() as at`;
        if (job!.retry_at.getTime() - clock!.at.getTime() > 1500)
          throw Error('Unexpected failure backoff in positive traversal');
        await owner`select pg_sleep(greatest(0,extract(epoch from retry_at-clock_timestamp()))+.01) from privacy_jobs where id=${jobId}`;
        await database.renewServiceInstance({ instanceId, role: 'web' });
        await ticks.get(1000)!();
      }
      await ticks.get(60_000)!();
      await service.stop();
      const before = requests.length;
      await ticks.get(1000)!();
      await ticks.get(60_000)!();
      const [stripe] =
        await owner`select status,attempts,billing_cleanup from privacy_jobs where id=${jobId}`;
      const [generic] =
        await owner`select status,attempts,billing_cleanup from privacy_jobs where id=${otherJob}`;
      const [remaining] =
        await owner`select count(*)::int as customers from billing_customers where user_id=${userId}`;
      assert({
        given: mapped
          ? 'the actual SDK with controlled positive unfiltered empty pages, real runtime storage and scheduled one-step delivery'
          : 'a closed free account with positively proved absence and no Stripe configuration',
        should:
          'complete only Stripe under current daisy_web authority, keep generic work untouched and stop both schedules without network/credential shortcuts',
        actual: {
          status: stripe!.status,
          attempts: stripe!.attempts,
          outcome: stripe!.billing_cleanup.outcome,
          generic,
          customers: remaining!.customers,
          roles: [...roles],
          requests,
          stoppedRequests: requests.length - before,
          cleared,
          failures: failures.length,
          healthy: logs.some(
            (record) =>
              record.event === 'worker.run.completed' &&
              record.fields.operation === 'billing_cleanup',
          ),
        },
        expected: {
          status: 'succeeded',
          attempts: 0,
          outcome: mapped ? 'vendor-deleted' : 'no-vendor-effects',
          generic: { status: 'pending', attempts: 0, billing_cleanup: null },
          customers: 0,
          roles: ['daisy_web'],
          requests: mapped
            ? [
                {
                  method: 'GET',
                  path: '/v1/subscriptions',
                  version: '2026-10-28.endive',
                },
                {
                  method: 'GET',
                  path: '/v1/invoices',
                  version: '2026-10-28.endive',
                },
                {
                  method: 'GET',
                  path: `/v1/customers/${customerId}`,
                  version: '2026-10-28.endive',
                },
                {
                  method: 'DELETE',
                  path: `/v1/customers/${customerId}`,
                  version: '2026-10-28.endive',
                },
              ]
            : [],
          stoppedRequests: 0,
          cleared: [1000, 60000],
          failures: 0,
          healthy: true,
        },
      });
    } finally {
      await service?.stop();
      await owner`delete from privacy_jobs where subject_ref=${userId}`;
      await owner`delete from billing_customers where user_id=${userId}`;
      await owner`delete from service_instances where instance_id=${instanceId}`;
      await owner`delete from actors where id=${actorId}`;
      await owner`delete from users where id=${userId}`;
      await pool.close({ timeout: 0 });
      await owner.close();
    }
  }, 15_000); // Five discovery heads and verified deletion retain their normal one-second progress due times.
