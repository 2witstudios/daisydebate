import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { CLIENT_IP_HEADER } from './client-ip';
import { create, magicLinkRequest } from './abuse.test-support';

setupRitewayBun();

describe('AUTH-3.4 limiter wiring', () => {
  test('per-recipient and per-client counters use one consume each with hashed-safe inputs', async () => {
    const { server, consumed } = create();
    await server.instance.handler(magicLinkRequest());
    assert({
      given: 'one magic-link request',
      should:
        'consume the client path key (3/60) and the recipient key (3/60) exactly once each',
      actual: consumed.map(({ key, rule }) => ({
        kind: key.startsWith('magic-link-recipient|') ? 'recipient' : 'client',
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
      .filter((key) => !key.startsWith('magic-link-recipient|'));
    assert({
      given: 'requests with and without the ingress identity, both forging XFF',
      should:
        'key the first by the stamped identity and never by the forged headers',
      actual: {
        stamped: clientKeys[0],
        forgedLeaks: clientKeys.some((key) => key.includes('203.0.113')),
      },
      expected: {
        stamped: '198.51.100.7|/sign-in/magic-link',
        forgedLeaks: false,
      },
    });
  });

  test('a denied consume answers 429 with retry information and sends nothing', async () => {
    const { server, sent } = create({
      limiter: () => async () => ({ allowed: false, retryAfterSeconds: 37 }),
    });
    const response = await server.instance.handler(magicLinkRequest());
    assert({
      given: 'a limiter that denies with 37 seconds remaining',
      should: 'return 429 with the retry seconds and deliver nothing',
      actual: {
        status: response.status,
        retry: response.headers.get('x-retry-after'),
        sent: sent.length,
      },
      expected: { status: 429, retry: '37', sent: 0 },
    });
  });

  test('a recipient-counter denial answers 429 with Retry-After', async () => {
    const { server, sent } = create({
      limiter: () => async (key) =>
        key.startsWith('magic-link-recipient|')
          ? { allowed: false, retryAfterSeconds: 12 }
          : { allowed: true, retryAfterSeconds: 0 },
    });
    const response = await server.instance.handler(magicLinkRequest());
    assert({
      given: 'the recipient counter exhausted',
      should: 'return 429 with Retry-After and deliver nothing',
      actual: [
        response.status,
        response.headers.get('retry-after'),
        sent.length,
      ],
      expected: [429, '12', 0],
    });
  });

  test('a limiter failure rejects the request instead of allowing it', async () => {
    const { server, sent } = create({
      limiter: () => async () => {
        throw new Error('redis down');
      },
    });
    let rejected = false;
    try {
      await server.instance.handler(magicLinkRequest());
    } catch {
      rejected = true;
    }
    assert({
      given: 'a limiter that throws (Redis outage)',
      should:
        'reject (mapped to 503 by the route boundary) and deliver nothing',
      actual: { rejected, sent: sent.length },
      expected: { rejected: true, sent: 0 },
    });
  });
});
