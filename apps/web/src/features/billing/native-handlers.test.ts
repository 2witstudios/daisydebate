import { assert, setupRitewayBun, test } from 'riteway/bun';
import { noopErrorReporter } from '@daisy/observability';
import { createAppError } from '@daisy/errors';
import type { Identity } from '@daisy/auth';
import { silentLogger } from '../../server/test-loggers.test-support';
import { createBillingNativeHandlers } from './native-handlers';
setupRitewayBun();
const origin = 'https://daisy.test';
const principal = { userId: 'u'.repeat(24), actorId: 'a'.repeat(24) };
const post = (body = '', from = origin, query = '') =>
  new Request(`${origin}/api/billing/checkout${query}`, {
    method: 'POST',
    headers: {
      origin: from,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  });
function fixtureIdentity(
  state: 'member' | 'anonymous' | 'provisional',
): Identity {
  if (state === 'anonymous') return { state, principal: { kind: 'anonymous' } };
  if (state === 'provisional')
    return {
      state,
      principal: { kind: 'user', userId: principal.userId, actorId: null },
    };
  return {
    state,
    username: 'member',
    principal: { ...principal, kind: 'user' },
  };
}
const setup = ({
  state = 'member',
  limited = false,
}: {
  readonly state?: 'member' | 'anonymous' | 'provisional';
  readonly limited?: boolean;
} = {}) => {
  const called: unknown[] = [];
  const boundary = {
    logger: silentLogger,
    reporter: noopErrorReporter,
    origin: () => origin,
    identify: async () => fixtureIdentity(state),
    limiter: () => ({
      consume: async () => ({ allowed: !limited, retryAfterSeconds: 1 }),
    }),
  };
  const handlers = createBillingNativeHandlers({
    boundary,
    checkout: async (subject) => {
      called.push(subject);
      return {
        kind: 'redirect',
        url: 'https://checkout.stripe.com/c/pay/cs_test_owned',
      };
    },
    portal: async () => ({ kind: 'unavailable' }),
  });
  return { handlers, called, boundary };
};
test('a native Checkout form returns a no-store 303 to validated hosted payment', async () => {
  const { handlers, called } = setup();
  const r = await handlers.checkout(post());
  assert({
    given: 'a plain same-origin form without JavaScript',
    should: 'use authenticated identity and navigate by POST/redirect/GET',
    actual: [
      r.status,
      r.headers.get('location'),
      r.headers.get('cache-control'),
      r.headers.get('referrer-policy'),
      called,
    ],
    expected: [
      303,
      'https://checkout.stripe.com/c/pay/cs_test_owned',
      'no-store',
      'no-referrer',
      [principal],
    ],
  });
});
test('forged form authority and cross-origin requests never call Checkout', async () => {
  const requests = [
    post('customer=cus_foreign'),
    post('price=price_foreign'),
    post('quantity=2'),
    post('return_url=https%3A%2F%2Fevil.example'),
    post('', 'https://evil.example'),
    post('', origin, '?purchase=forged'),
  ];
  const results = await Promise.all(
    requests.map(async (request) => {
      const { handlers, called } = setup();
      const response = await handlers.checkout(request);
      return [response.status, called.length];
    }),
  );
  assert({
    given: 'untrusted offer, owner, redirect or origin claims',
    should: 'refuse before vendor work',
    actual: results,
    expected: [
      [400, 0],
      [400, 0],
      [400, 0],
      [400, 0],
      [403, 0],
      [400, 0],
    ],
  });
});

test('anonymous, provisional and rate-limited callers never reach vendor work', async () => {
  const variants = [
    { state: 'anonymous' },
    { state: 'provisional' },
    { limited: true },
  ] as const;
  const result = await Promise.all(
    variants.map(async (variant) => {
      const { handlers, called } = setup(variant);
      const response = await handlers.checkout(post());
      return [response.status, called.length];
    }),
  );
  assert({
    given: 'missing signed-in ownership or an exhausted member budget',
    should: 'refuse before calling Checkout',
    actual: result,
    expected: [
      [401, 0],
      [403, 0],
      [429, 0],
    ],
  });
});

test('new-purchase refusal maps to HTTP404 without hiding the existing management entry', async () => {
  const { boundary } = setup();
  let admissions = 0,
    management = 0;
  const handlers = createBillingNativeHandlers({
    boundary,
    checkout: async () => {
      admissions += 1;
      throw createAppError('NOT_FOUND');
    },
    portal: async () => {
      management += 1;
      return { kind: 'unavailable' };
    },
  });
  const refused = await handlers.checkout(post());
  const portal = await handlers.portal(
    new Request(`${origin}/api/billing/portal`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/x-www-form-urlencoded' },
      body: '',
    }),
  );
  assert({
    given:
      'canonical new-purchase authority refuses after the authenticated native form boundary',
    should:
      'return404 while management continues through its own operation, without a blanket route display gate',
    actual: [refused.status, portal.status, admissions, management],
    expected: [404, 303, 1, 1],
  });
});
