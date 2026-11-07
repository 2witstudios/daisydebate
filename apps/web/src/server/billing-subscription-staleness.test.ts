import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import { createLogger } from '@daisy/logger';
import { subscriptionFreshness } from '../features/billing/subscription-staleness';
import {
  recordDisabledSubscriptionFreshness,
  subscriptionStalenessObserver,
} from './billing-subscription-staleness';
import { fixedClock } from '@daisy/clock';
import { createApp } from './app';
import { startBillingSubscriptions } from './billing-subscriptions';
import { authTestEnv } from '../features/auth/auth-server.test-support';
import { betaMessagingPolicy } from '../features/messaging/beta-policy';

setupRitewayBun();

test('subscription freshness observes actual pending age against the explicit target, independently of an empty successful worker tick', async () => {
  const events: { event: string; fields: Readonly<Record<string, unknown>> }[] =
    [];
  const app = createApp({
    env: {
      ...authTestEnv,
      DATABASE_URL: 'postgres://unit:unit@localhost:5432/unit',
      REDIS_URL: 'redis://localhost:6379',
      REDIS_NAMESPACE: 'billing-staleness-unit',
      LOG_LEVEL: 'silent',
    },
    messagingPolicy: betaMessagingPolicy,
    clock: fixedClock('2026-11-07T12:20:00.000Z'),
    ids: { next: createId },
    fetch: async () => {
      throw Error('Unexpected application network');
    },
  });
  const logger = {
    log: (event: string, fields: Readonly<Record<string, unknown>>) => {
      events.push({ event, fields });
    },
    child: () => logger,
  };
  const service = startBillingSubscriptions({
    app: {
      ...app,
      config: {
        ...app.config,
        billing: {
          kind: 'stripe',
          mode: 'test',
          secretKey: 'sk_test_unused',
          webhookSecret: 'whsec_unused',
          premiumPriceId: 'price_fixture',
          portalConfigurationId: 'bpc_fixture',
        },
      },
      logger,
      reporter: { capture: () => undefined },
      database: {
        ...app.database,
        billingSynchronization: () => ({
          receipts: async () => ({ rows: [], afterId: null, exhausted: true }),
          customers: async () => ({ rows: [], afterId: null, exhausted: true }),
          claim: async () => null,
          receive: async () => 'recorded' as const,
          retry: async () => true,
          apply: async () => 'applied' as const,
        }),
        billingSubscriptionStaleness: () => ({
          sample: async () => ({
            sampledAt: '2026-11-07T12:20:00.000Z',
            throughId: null,
            afterId: null,
            exhausted: true,
            scanned: 2,
            pending: 1,
            claimed: 0,
            settled: 1,
            unconfirmed: 1,
            oldestRevisionRequestedAt: '2026-11-07T12:00:00.000Z',
            oldestObservedAt: '2026-11-07T12:15:00.000Z',
          }),
        }),
      },
    },
    instanceId: createId(),
    timers: { setInterval: () => 1, clearInterval: () => undefined },
    fetch: Object.assign(
      async () => {
        throw Error('Freshness collection must not call a vendor');
      },
      { preconnect() {} },
    ),
  });
  try {
    await service?.started;
    const observation = events.find(
      (event) => event.event === 'billing.subscription.staleness',
    );
    assert({
      given:
        'a successful empty reconciliation tick and a twenty-minute pending synchronization',
      should:
        'expose the missed fifteen-minute data-freshness target rather than treating the tick as fresh',
      actual: observation
        ? {
            cause: observation.fields.cause,
            targetMs: observation.fields.stalenessTargetMs,
            pendingAgeMs: observation.fields.oldestRevisionRequestAgeMs,
          }
        : null,
      expected: { cause: 'stale', targetMs: 900_000, pendingAgeMs: 1_200_000 },
    });
  } finally {
    await service?.stop();
    await app.close();
  }
});

test('private observation logging carries only aggregate facts and reports stale transitions once', () => {
  const lines: string[] = [],
    stages: string[] = [];
  const app = {
    logger: createLogger({
      service: 'web',
      destination: {
        write: (text) => {
          lines.push(text);
        },
      },
    }),
  };
  const observer = subscriptionStalenessObserver(app, (_error, stage) =>
    stages.push(stage),
  );
  const sampledAt = '2026-11-07T12:20:00.000Z';
  const value = subscriptionFreshness(
    {
      sampledAt,
      scanned: 1,
      pending: 0,
      claimed: 1,
      settled: 0,
      unconfirmed: 0,
      oldestRevisionRequestedAt: sampledAt,
      oldestObservedAt: '2026-11-07T12:00:00.000Z',
    },
    true,
    { startedAt: sampledAt, pages: 1 },
  );
  observer.observed(value);
  observer.observed(value);
  recordDisabledSubscriptionFreshness(app);
  const parsed = lines.map((line) => JSON.parse(line));
  assert({
    given:
      'repeated stale observations then disabled configuration through the actual logger',
    should:
      'retain database coverage/ages, omit identities and avoid a repeated transition report',
    actual: [
      parsed.map((line) => [line.event, line.cause]),
      parsed[0].oldestObservedAgeMs,
      parsed[0].scanDurationMs,
      parsed[0].sampledAtMs,
      Object.keys(parsed[0]).some((key) =>
        /customer|subscriptionId|userId|afterId|throughId/.test(key),
      ),
      stages,
    ],
    expected: [
      [
        ['billing.subscription.staleness', 'stale'],
        ['billing.subscription.staleness', 'stale'],
        ['billing.subscription.staleness', 'disabled'],
      ],
      1_200_000,
      0,
      Date.parse(sampledAt),
      false,
      ['staleness_target'],
    ],
  });
});

test('unavailable source and broken diagnostic sink cannot throw back into reconciliation', () => {
  const stages: string[] = [];
  const app = {
    logger: {
      log: () => {
        throw Error('Controlled sink outage');
      },
      child: () => app.logger,
    },
  };
  const observer = subscriptionStalenessObserver(app, (_error, stage) =>
    stages.push(stage),
  );
  observer.unavailable(Error('Controlled source outage'));
  observer.unavailable(Error('Still unavailable'));
  recordDisabledSubscriptionFreshness(app);
  assert({
    given: 'both diagnostic logger and source are unavailable',
    should: 'contain sink errors and report the unavailable transition once',
    actual: stages,
    expected: ['staleness_collect'],
  });
});
