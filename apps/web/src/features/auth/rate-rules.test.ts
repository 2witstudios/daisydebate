import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { CLIENT_IP_HEADER } from './client-ip';
import { create, magicLinkRequest } from './abuse.test-support';

setupRitewayBun();

/** An account holding the address `magicLinkRequest` asks for. */
const existingAccount = {
  id: 'user-1',
  email: 'player@daisy.example.com',
  emailVerified: true,
  name: '',
  createdAt: new Date('2026-09-20T00:00:00.000Z'),
  updatedAt: new Date('2026-09-20T00:00:00.000Z'),
};

const getSession = (headers: Record<string, string> = {}) =>
  new Request('http://localhost:3000/api/auth/get-session', { headers });

describe('AUTH-3.4 rules the gate hands the atomic limiter', () => {
  test('a sign-up link request carries one client bucket, three recipient windows and two global ceilings', async () => {
    const { server, consumed } = create();
    await server.instance.handler(magicLinkRequest());
    const kindOf = (key: string) =>
      key.startsWith('auth:magic-link:recipient:')
        ? 'recipient'
        : key.startsWith('auth:magic-link:global:')
          ? 'global'
          : key.startsWith('auth:client:')
            ? 'client'
            : 'other';
    assert({
      given: 'one magic-link request for an address with no account',
      should:
        'consume the client bucket, all three recipient windows and both global ceilings, never carrying the address',
      actual: {
        rulesByKind: consumed.map(({ key, rule }) => ({
          kind: kindOf(key),
          rule,
        })),
        leaksAddress: consumed.some(({ key }) => key.includes('player@')),
      },
      expected: {
        rulesByKind: [
          { kind: 'client', rule: { windowSeconds: 60, max: 3 } },
          { kind: 'recipient', rule: { windowSeconds: 60, max: 3 } },
          { kind: 'recipient', rule: { windowSeconds: 3_600, max: 10 } },
          { kind: 'recipient', rule: { windowSeconds: 86_400, max: 20 } },
          { kind: 'global', rule: { windowSeconds: 60, max: 120 } },
          { kind: 'global', rule: { windowSeconds: 86_400, max: 3_000 } },
        ],
        leaksAddress: false,
      },
    });
  });

  test('a sign-in link for an existing account spends the global ceilings but is never held back by them (ISSUE-54, ISSUE-188)', async () => {
    const { server, db, consumed, sent } = create({
      limiter: (record) => async (key, rule) => {
        record.push({ key, rule });
        return key.startsWith('auth:magic-link:global:')
          ? { allowed: false, retryAfterSeconds: 30 }
          : { allowed: true, retryAfterSeconds: 0 };
      },
    });
    db.user.push(existingAccount);
    const response = await server.instance.handler(magicLinkRequest());
    assert({
      given:
        'saturated global ceilings and a magic-link request for an address that has an account',
      should:
        'spend the global ceiling exactly as a sign-up does, and still admit and mail the sign-in link',
      actual: {
        status: response.status,
        sent: sent.length,
        globalConsumed: consumed
          .filter(({ key }) => key.startsWith('auth:magic-link:global:'))
          .map(({ key }) => key),
      },
      expected: {
        status: 200,
        sent: 1,
        globalConsumed: ['auth:magic-link:global:60'],
      },
    });
  });

  test('an existing account and a new address spend the same buckets (ISSUE-188)', async () => {
    const unknown = create();
    const known = create();
    known.db.user.push(existingAccount);
    await unknown.server.instance.handler(magicLinkRequest());
    await known.server.instance.handler(magicLinkRequest());
    assert({
      given:
        'the same magic-link request with and without an account behind the address',
      should:
        'consume the identical buckets, so no counter depends on the account',
      actual: known.consumed,
      expected: unknown.consumed,
    });
  });

  test('a recipient exhausting the hour ceiling is denied even though the minute window just reset', async () => {
    const hourExhausted = new Set<string>();
    const { server } = create({
      limiter: () => async (key, rule) => {
        if (rule.windowSeconds === 3_600) {
          if (hourExhausted.has(key))
            return { allowed: false, retryAfterSeconds: 3_600 };
          hourExhausted.add(key);
        }
        return { allowed: true, retryAfterSeconds: 0 };
      },
    });
    const first = await server.instance.handler(magicLinkRequest());
    const second = await server.instance.handler(magicLinkRequest());
    assert({
      given:
        'a limiter whose recipient-hour bucket is already exhausted for a second send',
      should:
        'admit the first send and deny the second even though the minute window is fresh',
      actual: { first: first.status, second: second.status },
      expected: { first: 200, second: 429 },
    });
  });

  test('a saturated global per-minute ceiling drops the sign-up mail behind the ordinary success (ISSUE-182)', async () => {
    const { server, sent, db, logs } = create({
      limiter: () => async (key) =>
        key === 'auth:magic-link:global:60'
          ? { allowed: false, retryAfterSeconds: 30 }
          : { allowed: true, retryAfterSeconds: 0 },
    });
    const response = await server.instance.handler(magicLinkRequest());
    assert({
      given:
        'a limiter denying only the global per-minute bucket and a request for an address with no account',
      should:
        'answer the ordinary 200 with no Retry-After, send nothing, keep no token and log the denial',
      actual: {
        status: response.status,
        body: await response.json(),
        retryAfter: response.headers.has('retry-after'),
        sent: sent.length,
        tokens: db.verification.length,
        logged: logs.map(([event]) => event).includes('auth.rate_limit.denied'),
      },
      expected: {
        status: 200,
        body: { status: true },
        retryAfter: false,
        sent: 0,
        tokens: 0,
        logged: true,
      },
    });
  });

  test('a limiter outage on the global ceiling fails the sign-up closed with a 503 and no mail', async () => {
    const { server, sent } = create({
      limiter: () => async (key) => {
        if (key.startsWith('auth:magic-link:global:'))
          throw new Error('redis down');
        return { allowed: true, retryAfterSeconds: 0 };
      },
    });
    const response = await server.instance.handler(magicLinkRequest());
    assert({
      given: 'a limiter that fails only on the global ceiling',
      should: 'answer the public 503 and send nothing',
      actual: { status: response.status, sent: sent.length },
      expected: { status: 503, sent: 0 },
    });
  });

  test('a mail-provider failure under a saturated ceiling answers a new address and an existing account alike (ISSUE-189)', async () => {
    const saturated = () =>
      create({
        sendFailure: true,
        limiter: () => async (key) =>
          key.startsWith('auth:magic-link:global:')
            ? { allowed: false, retryAfterSeconds: 30 }
            : { allowed: true, retryAfterSeconds: 0 },
      });
    const unknown = saturated();
    const known = saturated();
    known.db.user.push(existingAccount);
    const answer = async (response: Response) => ({
      status: response.status,
      body: await response.text(),
      headers: [...response.headers.entries()],
    });
    const unknownAnswer = await answer(
      await unknown.server.instance.handler(magicLinkRequest()),
    );
    const knownAnswer = await answer(
      await known.server.instance.handler(magicLinkRequest()),
    );
    assert({
      given:
        'saturated global ceilings and a failing mail transport, for an address with and without an account',
      should:
        'answer both with the same status, body and headers, and keep no unmailed token',
      actual: {
        known: knownAnswer,
        status: knownAnswer.status,
        tokens: [known.db.verification.length, unknown.db.verification.length],
      },
      expected: { known: unknownAnswer, status: 200, tokens: [0, 0] },
    });
  });

  test('a mail-provider failure below the ceiling stays the retryable 503 for both (ISSUE-189)', async () => {
    const unknown = create({ sendFailure: true });
    const known = create({ sendFailure: true });
    known.db.user.push(existingAccount);
    const unknownResponse =
      await unknown.server.instance.handler(magicLinkRequest());
    const knownResponse =
      await known.server.instance.handler(magicLinkRequest());
    assert({
      given: 'a failing mail transport and a global ceiling with room',
      should: 'answer both with the same retryable 503 EMAIL_DELIVERY_FAILED',
      actual: {
        known: [knownResponse.status, await knownResponse.json()],
        unknown: [unknownResponse.status, await unknownResponse.json()],
      },
      expected: {
        known: [
          503,
          {
            code: 'EMAIL_DELIVERY_FAILED',
            message: 'We could not send the email. Please try again.',
          },
        ],
        unknown: [
          503,
          {
            code: 'EMAIL_DELIVERY_FAILED',
            message: 'We could not send the email. Please try again.',
          },
        ],
      },
    });
  });

  test('an email change carries its client bucket and the new address’s three recipient windows, whoever holds it (ISSUE-121)', async () => {
    const { server, db, consumed } = create();
    db.user.push(existingAccount);
    const changeTo = (newEmail: string) =>
      server.instance.handler(
        new Request('http://localhost:3000/api/auth/change-email', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: 'http://localhost:3000',
          },
          body: JSON.stringify({ newEmail }),
        }),
      );
    await changeTo('player@daisy.example.com');
    await changeTo('free@daisy.example.com');
    const shapeOf = ({ key, rule }: (typeof consumed)[number]) => ({
      kind: key.startsWith('auth:email-change:recipient:')
        ? 'recipient'
        : key.startsWith('auth:client:')
          ? 'client'
          : 'other',
      rule,
    });
    const perRequest = [
      { kind: 'client', rule: { windowSeconds: 60, max: 100 } },
      { kind: 'recipient', rule: { windowSeconds: 60, max: 3 } },
      { kind: 'recipient', rule: { windowSeconds: 3_600, max: 10 } },
      { kind: 'recipient', rule: { windowSeconds: 86_400, max: 20 } },
    ];
    assert({
      given:
        'an email change to an address that has an account, then to one that has none',
      should:
        'consume the same buckets for each, keyed on the new address and never carrying it, with no global ceiling',
      actual: {
        buckets: consumed.map(shapeOf),
        leaksAddress: consumed.some(({ key }) => key.includes('@')),
      },
      expected: {
        buckets: [...perRequest, ...perRequest],
        leaksAddress: false,
      },
    });
  });

  test('every other route carries the 100 per 60 seconds default', async () => {
    const { server, consumed } = create();
    await server.instance.handler(getSession());
    assert({
      given: 'a session read',
      should: 'consume one client bucket at 100/60',
      actual: consumed.map(({ rule }) => rule),
      expected: [{ windowSeconds: 60, max: 100 }],
    });
  });

  test('only the ingress-stamped identity selects the client bucket; forwarding headers are ignored', async () => {
    const { server, consumed } = create();
    await server.instance.handler(
      magicLinkRequest({
        'x-forwarded-for': '203.0.113.99',
        'x-real-ip': '203.0.113.98',
        [CLIENT_IP_HEADER]: '198.51.100.7',
      }),
    );
    await server.instance.handler(
      magicLinkRequest({ 'x-forwarded-for': '203.0.113.99' }),
    );
    const clientKeys = consumed
      .map(({ key }) => key)
      .filter((key) => key.startsWith('auth:client:'));
    assert({
      given: 'requests with and without the ingress identity, both forging XFF',
      should:
        'key the first by the stamped identity and never by the forged headers',
      actual: {
        stamped: clientKeys[0],
        unstamped: clientKeys[1],
        forgedLeaks: clientKeys.some((key) => key.includes('203.0.113')),
      },
      expected: {
        stamped: 'auth:client:198.51.100.7:/sign-in/magic-link',
        // Without the stamp Better Auth falls back to loopback in test/dev.
        unstamped: 'auth:client:127.0.0.1:/sign-in/magic-link',
        forgedLeaks: false,
      },
    });
  });

  test('the suppression list is only consulted after the rate gate admits the request', async () => {
    const throttled = create({
      limiter: () => async () => ({ allowed: false, retryAfterSeconds: 9 }),
    });
    const admitted = create();
    const denied = await throttled.server.instance.handler(magicLinkRequest());
    await admitted.server.instance.handler(magicLinkRequest());
    assert({
      given: 'a throttled request and an admitted request',
      should:
        'answer 429 without any suppression lookup, while the admitted one performs two: the gate before a token exists, then the one delivery path every auth mail shares (ISSUE-54)',
      actual: {
        status: denied.status,
        throttledLookups: throttled.lookups.count,
        admittedLookups: admitted.lookups.count,
      },
      expected: { status: 429, throttledLookups: 0, admittedLookups: 2 },
    });
  });
});
