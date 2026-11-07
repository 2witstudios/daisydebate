import { assert, setupRitewayBun, test } from 'riteway/bun';
import { fixedClock } from '@daisy/clock';
import type { Logger } from '@daisy/logger';
import {
  advanceCleanup,
  cleanupWork,
  startCleanup,
} from '@daisy/protocol/billing';
import { createApp } from './app';
import { startBillingCleanup } from './billing-cleanup';
import {
  configuredPrivacyJobVendors,
  genericPrivacyJobVendors,
  privacyJobPort,
} from './privacy-jobs';
import { authTestEnv } from '../features/auth/auth-server.test-support';
import { betaMessagingPolicy } from '../features/messaging/beta-policy';
setupRitewayBun();
const now = '2026-11-06T00:00:00.000Z',
  jobId = 'j'.repeat(24);
function build() {
  const app = createApp({
    env: {
      ...authTestEnv,
      DATABASE_URL: 'postgres://unit:unit@localhost:5432/unit',
      REDIS_URL: 'redis://localhost:6379',
      REDIS_NAMESPACE: 'billing-cleanup-unit',
      LOG_LEVEL: 'silent',
    },
    messagingPolicy: betaMessagingPolicy,
    clock: fixedClock(now),
    ids: { next: () => 'n'.repeat(24) },
    fetch: async () => {
      throw Error('Unexpected vendor transport');
    },
  });
  // Worker unit proofs must not inherit the app's asynchronous Redis alert tap.
  const logger: Logger = { log: () => undefined, child: () => logger };
  return { ...app, logger };
}
function claimed() {
  const initial = startCleanup(jobId, now);
  if (!initial) throw Error('Missing initial state');
  const result = advanceCleanup(
    initial,
    { kind: 'claim', claimId: 'c'.repeat(24) },
    { jobId, now, closed: true },
  );
  if (result.kind !== 'claimed') throw Error('Missing fixture claim');
  return {
    kind: 'claimed' as const,
    state: result.state,
    userId: 'u'.repeat(24),
    closedAt: '2026-11-05T00:00:00.000Z',
    work: cleanupWork(result.state)!,
    attempts: 0,
    facts: {
      route: { kind: 'absent' as const },
      effects: {
        mappedCustomers: 0,
        possiblePurchases: 0,
        retainedFinancialRoutes: 0,
        owedFinancialEffects: false,
      },
    },
  };
}

test('actual keyless scheduler separates Stripe closure from generic erase and drains both bounded schedules', async () => {
  const app = build(),
    due: unknown[] = [],
    owed: unknown[] = [],
    events: unknown[] = [],
    ticks = new Map<number, () => Promise<void>>(),
    cleared: number[] = [];
  const store = app.database.billingCleanup('s'.repeat(24));
  let claims = 0,
    rechecks = 0;
  const service = startBillingCleanup({
    app: {
      ...app,
      database: {
        ...app.database,
        billingCleanup: () => ({
          ...store,
          claim: async () => {
            claims++;
            return claimed();
          },
          record: async (_id, event) => {
            events.push(event);
            return 'complete';
          },
          rechecks: async () => {
            rechecks++;
            return { rows: [], next: null };
          },
        }),
        duePrivacyJobs: async (input) => {
          due.push(input);
          return [{ id: jobId, vendor: 'stripe', attempts: 99 }];
        },
        owedPrivacyJobs: async (input) => {
          owed.push(input);
          return 0;
        },
      },
    },
    instanceId: 's'.repeat(24),
    fetch: Object.assign(
      async () => {
        throw Error('Keyless process attempted vendor I/O');
      },
      { preconnect() {} },
    ),
    timers: {
      setInterval: (run, ms) => {
        ticks.set(ms, run);
        return ms;
      },
      clearInterval: (handle) => {
        cleared.push(Number(handle));
      },
    },
  });
  await service.started;
  await ticks.get(1000)!();
  const before = { claims, rechecks, due: due.length, owed: owed.length };
  await service.stop();
  await ticks.get(1000)!();
  await ticks.get(60000)!();
  let genericRefused = false;
  try {
    privacyJobPort(app, 'stripe');
  } catch {
    genericRefused = true;
  }
  assert({
    given:
      'a keyless process with a free closed account and deliberately stale queue attempts',
    should:
      'use the real local fenced completion, isolate Stripe delivery and avoid minute health/revisit spam on each delivery tick or after stop',
    actual: {
      before,
      after: { claims, rechecks, due: due.length, owed: owed.length },
      due,
      owed,
      kinds: events.map((event) => (event as { kind: string }).kind),
      cadences: [...ticks.keys()],
      cleared,
      genericIncludes: genericPrivacyJobVendors(app).includes('stripe'),
      configuredIncludes: configuredPrivacyJobVendors(app).includes('stripe'),
      genericRefused,
    },
    expected: {
      before: { claims: 2, rechecks: 1, due: 2, owed: 1 },
      after: { claims: 2, rechecks: 1, due: 2, owed: 1 },
      due: [
        { now, limit: 3, vendors: ['stripe'] },
        { now, limit: 3, vendors: ['stripe'] },
      ],
      owed: [{ vendors: ['stripe'] }],
      kinds: ['no-effects', 'no-effects'],
      cadences: [1000, 60000],
      cleared: [1000, 60000],
      genericIncludes: false,
      configuredIncludes: true,
      genericRefused: true,
    },
  });
});

test('actual scheduler reports private delivery failures while keeping subsequent accounts bounded and owed', async () => {
  const app = build(),
    signals: unknown[] = [],
    logs: unknown[] = [],
    claimedIds: string[] = [];
  const problem = Error(
    'Private invoice information must not enter log fields',
  );
  const store = app.database.billingCleanup('s'.repeat(24));
  const service = startBillingCleanup({
    app: {
      ...app,
      logger: {
        ...app.logger,
        log: (event, fields) => {
          logs.push({ event, fields });
        },
      },
      reporter: {
        capture: (error, context) => {
          signals.push({
            same: error === problem,
            route: context.route,
            errorCode: context.errorCode,
          });
        },
      },
      database: {
        ...app.database,
        billingCleanup: () => ({
          ...store,
          claim: async (id) => {
            claimedIds.push(id);
            throw problem;
          },
          rechecks: async () => ({ rows: [], next: null }),
        }),
        duePrivacyJobs: async () => [
          { id: jobId, vendor: 'stripe', attempts: 0 },
          { id: 'k'.repeat(24), vendor: 'stripe', attempts: 0 },
        ],
        owedPrivacyJobs: async () => 2,
      },
    },
    instanceId: 's'.repeat(24),
    fetch: Object.assign(
      async () => {
        throw Error('Unexpected vendor request');
      },
      { preconnect() {} },
    ),
    timers: { setInterval: () => 1, clearInterval: () => undefined },
  });
  await service.started;
  await service.stop();
  assert({
    given:
      'two current accounts whose database admission fails with private details',
    should:
      'report both through scrubbed reporter routing, continue the bounded batch and never put exception details in structured fields',
    actual: {
      claimedIds,
      signals,
      failures: logs.filter(
        (value) =>
          (value as { event: string }).event === 'billing.cleanup.failed',
      ).length,
      leaked: JSON.stringify(logs).includes(problem.message),
    },
    expected: {
      claimedIds: [jobId, 'k'.repeat(24)],
      signals: [
        {
          same: true,
          route: 'billing.cleanup.delivery',
          errorCode: 'INTERNAL',
        },
        {
          same: true,
          route: 'billing.cleanup.delivery',
          errorCode: 'INTERNAL',
        },
      ],
      failures: 2,
      leaked: false,
    },
  });
});
