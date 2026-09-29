import { readFileSync } from 'node:fs';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { resolveTrustedProxies } from '../../server/trusted-proxies';
import { resolveClientIp } from './client-ip';

setupRitewayBun();

/** The real deployed value, read straight from fly.toml — never hand-copied, so a future edit to it is caught here too. */
const deployedEntries = (): readonly string[] => {
  const toml = readFileSync(
    new URL('../../../../../fly.toml', import.meta.url),
    'utf8',
  );
  const match = /^\s*AUTH_TRUSTED_PROXIES\s*=\s*"([^"]*)"/m.exec(toml);
  if (!match) throw new Error('fly.toml has no AUTH_TRUSTED_PROXIES');
  return match[1]!.split(',').filter(Boolean);
};

/** fly-proxy's peer address measured on the staging machine (ISSUE-162). */
const MEASURED_GATEWAY = '172.19.3.97';

/** The deployed config as the server edge resolves it on that machine. */
const deployedTrustedProxies = () =>
  resolveTrustedProxies(deployedEntries(), MEASURED_GATEWAY).trustedProxies;

const resolveAgainstDeployed = (peer: string) =>
  resolveClientIp({
    peer,
    forwardedFor: '198.51.100.7',
    flyClientIp: '203.0.113.9',
    trustedProxies: deployedTrustedProxies(),
  });

describe('AUTH_TRUSTED_PROXIES trust boundary (ISSUE-162/DEC-39)', () => {
  test("the deployed AUTH_TRUSTED_PROXIES trusts only the machine's default gateway", () => {
    assert({
      given:
        "fly.toml's real AUTH_TRUSTED_PROXIES, resolved on the measured machine",
      should: 'trust exactly the one gateway address and no range',
      actual: deployedTrustedProxies(),
      expected: [MEASURED_GATEWAY],
    });
  });

  test('fly-proxy connecting from the gateway', () => {
    assert({
      given: 'a peer at the measured gateway carrying Fly-Client-IP',
      should: "resolve to Fly's authoritative caller address",
      actual: resolveAgainstDeployed(MEASURED_GATEWAY),
      expected: '203.0.113.9',
    });
  });

  test('another private IPv4 peer forging the headers', () => {
    assert({
      given: 'a peer elsewhere in 172.16.0.0/12 forging Fly-Client-IP',
      should: 'ignore the headers and resolve to the peer itself',
      actual: resolveAgainstDeployed('172.16.3.98'),
      expected: '172.16.3.98',
    });
  });

  test('a 6PN peer forging the headers', () => {
    assert({
      given:
        'a peer on the org-wide 6PN network (fdaa::/8) forging Fly-Client-IP',
      should: 'ignore the headers and resolve to the peer itself',
      actual: resolveAgainstDeployed('fdaa::1'),
      expected: 'fdaa::1',
    });
  });

  test("a peer on Fly's public edge range forging the headers", () => {
    assert({
      given: 'a peer at 66.241.125.10 forging Fly-Client-IP',
      should: 'ignore the headers and resolve to the peer itself',
      actual: resolveAgainstDeployed('66.241.125.10'),
      expected: '66.241.125.10',
    });
  });
});
