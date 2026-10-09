import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { resolveClientIp } from './client-ip';
setupRitewayBun();

describe('resolveClientIp', () => {
  test('without trusted proxies only the socket peer identifies the client', () => {
    assert({
      given: 'forged forwarding headers and no trusted ingress',
      should: 'ignore them and use the connection peer',
      actual: resolveClientIp({
        peer: '203.0.113.9',
        forwardedFor: '1.2.3.4, 5.6.7.8',
        trustedProxies: [],
      }),
      expected: '203.0.113.9',
    });
  });

  test('a trusted ingress hop reveals the client from the right of the chain', () => {
    assert({
      given: 'a trusted load balancer and a spoofed left-most entry',
      should: 'return the first untrusted hop from the right, not the spoof',
      actual: resolveClientIp({
        peer: '10.0.0.7',
        forwardedFor: '6.6.6.6, 198.51.100.4',
        trustedProxies: ['10.0.0.0/8'],
      }),
      expected: '198.51.100.4',
    });
  });

  test('an untrusted peer cannot borrow forwarding headers even from a trusted range claim', () => {
    assert({
      given: 'a direct client presenting X-Forwarded-For',
      should: 'use its own address',
      actual: resolveClientIp({
        peer: '192.0.2.50',
        forwardedFor: '10.0.0.1',
        trustedProxies: ['10.0.0.0/8'],
      }),
      expected: '192.0.2.50',
    });
  });

  test('normalizes IPv4-mapped IPv6 peers and handles absent chains', () => {
    assert({
      given: 'an IPv4-mapped peer and a trusted proxy without a chain',
      should: 'resolve to the normalized peer',
      actual: [
        resolveClientIp({
          peer: '::ffff:203.0.113.9',
          forwardedFor: null,
          trustedProxies: [],
        }),
        resolveClientIp({
          peer: '10.0.0.7',
          forwardedFor: null,
          trustedProxies: ['10.0.0.0/8'],
        }),
      ],
      expected: ['203.0.113.9', '10.0.0.7'],
    });
  });

  test('malformed chain entries fall back to the trusted peer, never a caller value', () => {
    assert({
      given: 'a trusted peer with a garbage forwarded entry',
      should: 'not adopt the garbage as the client identity',
      actual: resolveClientIp({
        peer: '10.0.0.7',
        forwardedFor: 'not-an-ip',
        trustedProxies: ['10.0.0.0/8'],
      }),
      expected: '10.0.0.7',
    });
  });

  test('a missing peer yields no identity', () => {
    assert({
      given: 'a request without a socket address',
      should: 'return null',
      actual: resolveClientIp({
        peer: undefined,
        forwardedFor: '1.1.1.1',
        trustedProxies: [],
      }),
      expected: null,
    });
  });

  test("a trusted peer's Fly-Client-IP is taken directly, without walking X-Forwarded-For", () => {
    assert({
      given:
        'a trusted fly-proxy peer carrying both Fly-Client-IP and an X-Forwarded-For chain',
      should: "resolve to Fly's authoritative single value",
      actual: resolveClientIp({
        peer: 'fdaa::1',
        forwardedFor: '6.6.6.6, 198.51.100.4',
        flyClientIp: '203.0.113.9',
        trustedProxies: ['fdaa::/8'],
      }),
      expected: '203.0.113.9',
    });
  });

  test("an untrusted peer's Fly-Client-IP is never honored; zero trust falls back to the peer", () => {
    assert({
      given: 'a direct, untrusted caller forging Fly-Client-IP',
      should: 'ignore the header entirely and use its own address',
      actual: resolveClientIp({
        peer: '192.0.2.50',
        forwardedFor: null,
        flyClientIp: '198.51.100.4',
        trustedProxies: ['fdaa::/8'],
      }),
      expected: '192.0.2.50',
    });
  });

  test('a trusted peer with a malformed Fly-Client-IP falls back to walking X-Forwarded-For', () => {
    assert({
      given: 'a trusted peer whose Fly-Client-IP is not a usable address',
      should: 'ignore it and resolve the chain as before',
      actual: resolveClientIp({
        peer: '10.0.0.7',
        forwardedFor: '6.6.6.6, 198.51.100.4',
        flyClientIp: 'not-an-ip',
        trustedProxies: ['10.0.0.0/8'],
      }),
      expected: '198.51.100.4',
    });
  });

  test('a trusted peer with no Fly-Client-IP still resolves through X-Forwarded-For', () => {
    assert({
      given: 'a trusted peer sending no Fly-Client-IP header at all',
      should: 'fall back to the existing chain-walking behavior',
      actual: resolveClientIp({
        peer: '10.0.0.7',
        forwardedFor: '6.6.6.6, 198.51.100.4',
        trustedProxies: ['10.0.0.0/8'],
      }),
      expected: '198.51.100.4',
    });
  });
});
