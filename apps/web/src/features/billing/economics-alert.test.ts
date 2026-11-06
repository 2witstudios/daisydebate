import { assert, setupRitewayBun, test } from 'riteway/bun';
import { runEconomicsReport } from './economics-alert';
setupRitewayBun();
test('failed private input delivery remains a failure without emitting the raw error', async () => {
  const events: unknown[] = [];
  const r = await runEconomicsReport({
    read: async () => {
      throw new Error('private payment detail');
    },
    save: async () => undefined,
    now: () => '2026-11-06T00:00:00.000Z',
    reporter: {
      capture: (error, context) => {
        events.push({
          message: error instanceof Error ? error.message : 'invalid',
          context,
        });
      },
    },
  });
  assert({
    given: 'an unavailable private measurement source',
    should:
      'return a fixed delivery failure without raw financial context or a healthy verdict',
    actual: [r, events],
    expected: [
      { kind: 'failed', reason: 'economics_delivery_failed' },
      [
        {
          message: 'BILLING_ECONOMICS_INCOMPLETE',
          context: {
            route: 'billing.economics.premium',
            errorCode: 'BILLING_ECONOMICS_INCOMPLETE',
            requestId: 'delivery-failed',
          },
        },
      ],
    ],
  });
});

test('a known crossing produces the named private alert only after report persistence', async () => {
  const { dataset, now } = await import('./economics.test-support');
  const events: unknown[] = [];
  const result = await runEconomicsReport({
    read: async () => dataset(),
    now: () => now,
    save: async () => {
      events.push('saved');
    },
    reporter: {
      capture: (error, context) => {
        events.push({
          message: error instanceof Error ? error.message : 'invalid',
          context,
        });
      },
    },
  });
  assert({
    given:
      'a completed measured Premium month below the thirty-percent floor and missing free/beta measurements',
    should:
      'persist the actual report and produce only fixed private low-margin/completeness signals without financial or personal dimensions',
    actual: [result.kind, events],
    expected: [
      'reported',
      [
        'saved',
        {
          message: 'BILLING_ECONOMICS_INCOMPLETE',
          context: {
            route: 'billing.economics.free',
            errorCode: 'BILLING_ECONOMICS_INCOMPLETE',
            requestId: '2026-10',
          },
        },
        {
          message: 'BILLING_ECONOMICS_INCOMPLETE',
          context: {
            route: 'billing.economics.beta',
            errorCode: 'BILLING_ECONOMICS_INCOMPLETE',
            requestId: '2026-10',
          },
        },
        {
          message: 'BILLING_LOW_MARGIN',
          context: {
            route: 'billing.economics.premium',
            errorCode: 'BILLING_LOW_MARGIN',
            requestId: '2026-10',
          },
        },
      ],
    ],
  });
});
test('private persistence and alert delivery failures remain visible to the caller', async () => {
  const { dataset, now } = await import('./economics.test-support');
  const input = {
    read: async () => dataset(),
    now: () => now,
    save: async () => undefined,
    reporter: { capture: () => undefined },
  };
  const results = await Promise.all([
    runEconomicsReport({
      ...input,
      save: async () => {
        throw new Error('private sink');
      },
    }),
    runEconomicsReport({
      ...input,
      reporter: {
        capture: () => {
          throw new Error('private adapter');
        },
      },
    }),
  ]);
  assert({
    given: 'a failed private report sink or failed alert delivery',
    should: 'return failure instead of suppressing the missing report or alert',
    actual: results.map((r) => r.kind),
    expected: ['failed', 'failed'],
  });
});
