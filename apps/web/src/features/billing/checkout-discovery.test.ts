import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  discoverCheckout as discover,
  type CheckoutSearchPort,
  checkoutSearchParameters,
} from './checkout-discovery';
import { checkoutSession, purchase } from './checkout.test-support';
setupRitewayBun();
const discoverCheckout = (
  port: CheckoutSearchPort,
  subject: Parameters<typeof discover>[1],
) => discover({ port, mode: 'test' }, subject);
const summary = {
  id: checkoutSession.id,
  created: checkoutSession.created,
  livemode: false,
  metadata: checkoutSession.metadata,
  client_reference_id: purchase.id,
};
const page = (data: unknown[], has_more = false) => ({
  object: 'list',
  data,
  has_more,
});

test('unknown Checkout recovery bounds the historical search and verifies the one selected result', async () => {
  const calls: unknown[] = [];
  const result = await discoverCheckout(
    {
      list: async (parameters) => {
        calls.push(parameters);
        return page([summary]);
      },
      retrieve: async (id) => {
        calls.push(id);
        return { ...checkoutSession, status: 'expired', url: null };
      },
    },
    purchase,
  );
  assert({
    given:
      'a previously lost Session found through its immutable purchase marker',
    should: 'make one bounded historical list call and one verified retrieval',
    actual: [calls, result],
    expected: [
      [
        {
          created: {
            gte: checkoutSession.created - 1,
            lt: checkoutSession.created + 300,
          },
          limit: 100,
        },
        checkoutSession.id,
      ],
      {
        kind: 'observed',
        session: { kind: 'expired', id: checkoutSession.id, customerId: null },
        url: null,
      },
    ],
  });
});

test('bounded absent results advance an exact cursor without claiming that no purchase occurred', async () => {
  const unrelated = {
    ...summary,
    id: 'cs_test_other',
    metadata: {},
    client_reference_id: null,
  };
  const port = {
    list: async () => page([unrelated], true),
    retrieve: async () => {
      throw Error('Unrelated Session must not be retrieved');
    },
  };
  assert({
    given: 'a full page without the owned purchase identity',
    should: 'request durable cursor progress without releasing the attempt',
    actual: await discoverCheckout(port, purchase),
    expected: {
      kind: 'searched',
      beforeSessionId: null,
      afterSessionId: 'cs_test_other',
    },
  });
  const resumed = {
    ...purchase,
    state: {
      kind: 'unknown' as const,
      startedAt: '2026-11-05T00:00:01.000Z',
      retryAt: '2026-11-05T00:05:01.000Z',
      afterSessionId: 'cs_test_other',
    },
  };
  assert({
    given: 'the last empty page after a persisted cursor',
    should:
      'reset only the scan cursor while leaving possible execution unresolved',
    actual: [
      checkoutSearchParameters(resumed),
      await discoverCheckout({ ...port, list: async () => page([]) }, resumed),
    ],
    expected: [
      {
        created: {
          gte: checkoutSession.created - 1,
          lt: checkoutSession.created + 300,
        },
        limit: 100,
        starting_after: 'cs_test_other',
      },
      {
        kind: 'searched',
        beforeSessionId: 'cs_test_other',
        afterSessionId: null,
      },
    ],
  });
});

test('ambiguous, out-of-window and nonprogressing vendor pages cannot become durable purchase facts', async () => {
  const invalid = [
    page([], true),
    page([summary, { ...summary, id: 'cs_test_duplicate' }]),
    page([{ ...summary, livemode: true }]),
    page([{ ...summary, created: summary.created - 2 }]),
    page([{ ...summary, created: summary.created + 300 }]),
    page(Array.from({ length: 101 }, () => summary)),
  ];
  let reads = 0;
  const results = [];
  for (const value of invalid)
    results.push(
      await discoverCheckout(
        {
          list: async () => value,
          retrieve: async () => {
            reads++;
            return checkoutSession;
          },
        },
        purchase,
      ),
    );
  assert({
    given:
      'empty truncated, duplicate matching, wrong-mode, out-of-window or oversized pages',
    should: 'refuse each before retrieving a candidate',
    actual: [results.map((r) => r.kind), reads],
    expected: [invalid.map(() => 'refuse'), 0],
  });
  assert({
    given: 'a marker-matched Session with an altered offer on full retrieval',
    should: 'refuse its otherwise plausible identity',
    actual: await discoverCheckout(
      {
        list: async () => page([summary]),
        retrieve: async () => ({ ...checkoutSession, amount_subtotal: 100 }),
      },
      purchase,
    ),
    expected: { kind: 'refuse' },
  });
});

test('discovery never creates a Session and preserves unknown transport outcomes', async () => {
  const noCall = {
    list: async () => {
      throw Error('raw vendor error');
    },
    retrieve: async () => {
      throw Error('raw vendor error');
    },
  };
  assert({
    given: 'a list failure or a lost selected-result read',
    should: 'remain unknown without exposing the raw exception',
    actual: [
      await discoverCheckout(noCall, purchase),
      await discoverCheckout(
        { ...noCall, list: async () => page([summary]) },
        purchase,
      ),
    ],
    expected: [{ kind: 'unknown' }, { kind: 'unknown' }],
  });
  let calls = 0;
  assert({
    given: 'a never-dispatched or terminal abandoned attempt',
    should: 'refuse discovery before any vendor read',
    actual: await discoverCheckout(
      {
        ...noCall,
        list: async () => {
          calls++;
          return page([]);
        },
      },
      { ...purchase, state: { kind: 'admitted' } },
    ),
    expected: { kind: 'refuse' },
  });
  assert({
    given: 'that refused identity',
    should: 'have caused no list call',
    actual: calls,
    expected: 0,
  });
  const wrongMode = await discover(
    {
      port: {
        ...noCall,
        list: async () => {
          calls++;
          return page([]);
        },
      },
      mode: 'live',
    },
    purchase,
  );
  assert({
    given: 'a TEST purchase with a LIVE configured vendor',
    should: 'refuse before any vendor call',
    actual: [wrongMode, calls],
    expected: [{ kind: 'refuse' }, 0],
  });
});

test('a restarted scan refuses a repeated vendor cursor instead of stalling its durable progress', async () => {
  const resumed = {
    ...purchase,
    state: {
      kind: 'unknown' as const,
      startedAt: '2026-11-05T00:00:01.000Z',
      retryAt: '2026-11-05T00:05:01.000Z',
      afterSessionId: summary.id,
    },
  };
  assert({
    given: 'a response containing the exact Session used as starting_after',
    should: 'refuse the nonprogressing page without retrieving it',
    actual: await discoverCheckout(
      {
        list: async () => page([summary], true),
        retrieve: async () => {
          throw Error('No repeated retrieval');
        },
      },
      resumed,
    ),
    expected: { kind: 'refuse' },
  });
});
