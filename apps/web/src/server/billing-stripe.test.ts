import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { BillingConfig } from '@daisy/config';
import { createBillingStripe } from './billing-stripe';

setupRitewayBun();

const config: BillingConfig = {
  kind: 'stripe',
  mode: 'test',
  secretKey: 'sk_test_fixture',
  webhookSecret: 'whsec_fixture',
  premiumPriceId: 'price_fixture',
  portalConfigurationId: 'bpc_fixture',
};

test('disabled beta configuration has no Stripe resource or transport work', () => {
  let calls = 0;
  const resource = createBillingStripe(
    { kind: 'disabled' },
    Object.assign(
      async () => {
        calls += 1;
        throw new Error('Unexpected transport');
      },
      { preconnect() {} },
    ),
  );
  assert({
    given: 'the supported no-Stripe beta configuration',
    should: 'remain inert without substituting credentials',
    actual: [resource, calls],
    expected: [null, 0],
  });
});

test('the actual SDK uses the pinned API and performs no implicit failed-request retry', async () => {
  const requests: { version: string | null; method: string }[] = [];
  const transport: import('./billing-stripe').BillingFetch = Object.assign(
    async (
      _url: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      requests.push({
        version: new Headers(init?.headers).get('Stripe-Version'),
        method: init?.method ?? 'GET',
      });
      return Response.json(
        { error: { type: 'api_error', message: 'Controlled failure' } },
        { status: 500 },
      );
    },
    { preconnect() {} },
  );
  const client = createBillingStripe(config, transport);
  let refused = false;
  try {
    await client?.checkout.sessions.retrieve('cs_test_fixture');
  } catch {
    refused = true;
  }
  assert({
    given: 'a configured SDK resource receiving one controlled server error',
    should:
      'retain its explicit API version and leave recovery to the durable operation',
    actual: { refused, requests },
    expected: {
      refused: true,
      requests: [{ version: '2026-10-28.endive', method: 'GET' }],
    },
  });
});
