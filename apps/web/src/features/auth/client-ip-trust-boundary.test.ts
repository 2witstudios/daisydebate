import { readFileSync } from 'node:fs';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { resolveClientIp } from './client-ip';

setupRitewayBun();

/** The real deployed value, read straight from fly.toml — never hand-copied, so a future edit to it is caught here too. */
const deployedTrustedProxies = (): readonly string[] => {
  const toml = readFileSync(
    new URL('../../../../../fly.toml', import.meta.url),
    'utf8',
  );
  const match = /^\s*AUTH_TRUSTED_PROXIES\s*=\s*"([^"]*)"/m.exec(toml);
  if (!match) throw new Error('fly.toml has no AUTH_TRUSTED_PROXIES');
  return match[1]!.split(',').filter(Boolean);
};

describe('AUTH_TRUSTED_PROXIES trust boundary (ISSUE-162/DEC-36)', () => {
  test("the deployed AUTH_TRUSTED_PROXIES trusts only fly-proxy's 6PN (fdaa::/8), never the org-wide private IPv4 range or the public anycast edge range", () => {
    assert({
      given: "fly.toml's real AUTH_TRUSTED_PROXIES value",
      should:
        'be exactly fdaa::/8, with 172.16.0.0/12 and 66.241.124.0/22 dropped',
      actual: deployedTrustedProxies(),
      expected: ['fdaa::/8'],
    });
  });

  test('a spoofed Fly-Client-IP from a peer on the now-untrusted 172.16.0.0/12 range is ignored, resolving to the peer itself', () => {
    assert({
      given:
        'a peer at 172.16.5.9 (previously trusted as a fly-proxy IPv4 path) forging Fly-Client-IP, against the real deployed trust config',
      should:
        "ignore the header entirely — 172.16.0.0/12 is no longer trusted — and resolve to the peer's own address",
      actual: resolveClientIp({
        peer: '172.16.5.9',
        forwardedFor: null,
        flyClientIp: '203.0.113.9',
        trustedProxies: deployedTrustedProxies(),
      }),
      expected: '172.16.5.9',
    });
  });

  test('a spoofed Fly-Client-IP from a peer on the now-untrusted Fly anycast edge range (66.241.124.0/22) is ignored', () => {
    assert({
      given:
        'a peer at 66.241.125.10 (previously trusted as the Fly edge fallback) forging Fly-Client-IP, against the real deployed trust config',
      should: 'ignore the header entirely and resolve to the peer itself',
      actual: resolveClientIp({
        peer: '66.241.125.10',
        forwardedFor: null,
        flyClientIp: '203.0.113.9',
        trustedProxies: deployedTrustedProxies(),
      }),
      expected: '66.241.125.10',
    });
  });

  test('a genuine fly-proxy 6PN peer is still trusted after the narrowing', () => {
    assert({
      given:
        'a peer on fdaa::/8 carrying Fly-Client-IP, against the real deployed trust config',
      should:
        "resolve to Fly's authoritative value, unaffected by the narrowing",
      actual: resolveClientIp({
        peer: 'fdaa::1',
        forwardedFor: null,
        flyClientIp: '203.0.113.9',
        trustedProxies: deployedTrustedProxies(),
      }),
      expected: '203.0.113.9',
    });
  });
});
