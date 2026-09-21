import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { CLIENT_IP_HEADER } from './client-ip';
import { create, magicLinkRequest } from './abuse.test-support';

setupRitewayBun();

const getSession = (headers: Record<string, string> = {}) =>
  new Request('http://localhost:3000/api/auth/get-session', { headers });

describe('AUTH-3.4 rules the gate hands the atomic limiter', () => {
  test('magic-link requests carry 3 per 60 seconds per client and per recipient', async () => {
    const { server, consumed } = create();
    await server.instance.handler(magicLinkRequest());
    assert({
      given: 'one magic-link request',
      should:
        'consume the client bucket and the hashed recipient bucket, each 3/60 and never carrying the address',
      actual: consumed.map(({ key, rule }) => ({
        kind: key.startsWith('auth:magic-link:recipient:')
          ? 'recipient'
          : key.startsWith('auth:client:')
            ? 'client'
            : 'other',
        rule,
        leaksAddress: key.includes('player@'),
      })),
      expected: [
        {
          kind: 'client',
          rule: { windowSeconds: 60, max: 3 },
          leaksAddress: false,
        },
        {
          kind: 'recipient',
          rule: { windowSeconds: 60, max: 3 },
          leaksAddress: false,
        },
      ],
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
        'answer 429 without any suppression lookup, while the admitted one performs exactly one',
      actual: {
        status: denied.status,
        throttledLookups: throttled.lookups.count,
        admittedLookups: admitted.lookups.count,
      },
      expected: { status: 429, throttledLookups: 0, admittedLookups: 1 },
    });
  });
});
