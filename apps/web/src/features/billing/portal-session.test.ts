import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createPortalSession } from './portal-session';
setupRitewayBun();
const customer = { id: 'cus_owned', mode: 'test' as const };
const subject = { userId: 'u'.repeat(24), actorId: 'a'.repeat(24) };
const configurationId = 'bpc_owned';
const returnOrigin = 'https://daisy.example';
const session = {
  id: 'bps_owned',
  object: 'billing_portal.session',
  customer: customer.id,
  configuration: configurationId,
  livemode: false,
  return_url: `${returnOrigin}/settings/billing`,
  url: 'https://billing.stripe.com/p/session/test_owned',
};
test('Portal uses only current owned customer routing and fixed return/configuration', async () => {
  const parameters: unknown[] = [];
  let reads = 0;
  const open = createPortalSession({
    mode: 'test',
    configurationId,
    returnOrigin,
    customer: async () => {
      reads++;
      return customer;
    },
    create: async (input) => {
      parameters.push(input);
      return session;
    },
  });
  assert({
    given: 'an authenticated current customer',
    should: 'recheck ownership after the bounded vendor request',
    actual: [await open(subject), reads, parameters],
    expected: [
      { kind: 'redirect', url: session.url },
      2,
      [
        {
          customer: customer.id,
          configuration: configurationId,
          return_url: session.return_url,
        },
      ],
    ],
  });
});
test('Portal rejects foreign, cross-mode, changed-return and non-Stripe destinations', async () => {
  const values = [
    { ...session, customer: 'cus_foreign' },
    { ...session, livemode: true },
    { ...session, configuration: 'bpc_foreign' },
    { ...session, return_url: 'https://evil.example' },
    {
      ...session,
      url: 'https://billing.stripe.com.evil.example/p/session/test_owned',
    },
    {
      ...session,
      url: 'https://attacker@billing.stripe.com/p/session/test_owned',
    },
  ];
  const results = await Promise.all(
    values.map((value) =>
      createPortalSession({
        mode: 'test',
        configurationId,
        returnOrigin,
        customer: async () => customer,
        create: async () => value,
      })(subject),
    ),
  );
  assert({
    given: 'untrusted vendor response identities and destinations',
    should: 'disclose no portal URL',
    actual: results,
    expected: values.map(() => ({ kind: 'unavailable' })),
  });
});
test('Portal closure during I/O and vendor transport failure never expose a session', async () => {
  let reads = 0;
  const closed = createPortalSession({
    mode: 'test',
    configurationId,
    returnOrigin,
    customer: async () => (++reads === 1 ? customer : null),
    create: async () => session,
  });
  const failed = createPortalSession({
    mode: 'test',
    configurationId,
    returnOrigin,
    customer: async () => customer,
    create: async () => {
      throw Error('private Stripe response');
    },
  });
  assert({
    given: 'closure races or lost vendor response',
    should: 'return a fixed unavailable outcome',
    actual: [await closed(subject), await failed(subject)],
    expected: [{ kind: 'unavailable' }, { kind: 'unavailable' }],
  });
});
