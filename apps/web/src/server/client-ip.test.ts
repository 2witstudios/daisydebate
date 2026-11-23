import {
  CLIENT_IP_HEADER,
  FLY_CLIENT_IP_HEADER,
} from '@daisy/ingress/client-ip';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  CLIENT_ID_HASH_HEADER,
  clientIdHash,
  deriveClientIdSubkey,
  stampClientIdentity,
} from './client-ip';

// Known-answer vectors, computed independently (Python hashlib.sha3_256)
// for BETTER_AUTH_SECRET = 'a' x 64 and the client 203.0.113.9.
const SECRET = 'a'.repeat(64);
const SUBKEY =
  '34fdda7811c86781a47a99160ee51451a4c33418915e369cc4a06d7df5a90a76';
const KEYED =
  '5630bc61fdecfeaed71c2c477912209c9c8626ca5dd485455024185bffa9d87b';
const UNKEYED =
  '6896eba5c88ed496934ccd4986c63e35dc5f89210f182d4dadd9b218a09337e1';

setupRitewayBun();

describe('clientIdHash', () => {
  test('a subkey derived from the app secret under its own label', () => {
    assert({
      given: "BETTER_AUTH_SECRET 'a' x 64",
      should:
        'derive SHA3-256(secret, NUL, "client-id-hash"), the known-answer subkey',
      actual: deriveClientIdSubkey(SECRET),
      expected: SUBKEY,
    });
  });

  test('keyed, so the IPv4 space cannot be enumerated to reverse it', () => {
    const keyed = clientIdHash(deriveClientIdSubkey(SECRET), '203.0.113.9');
    assert({
      given: 'a client address and the derived subkey',
      should:
        'equal the keyed known-answer vector and differ from the plain SHA3-256 of the address',
      actual: { keyed, differsFromUnkeyed: keyed !== UNKEYED },
      expected: { keyed: KEYED, differsFromUnkeyed: true },
    });
  });
});

describe('stampClientIdentity', () => {
  test('overwrites a caller-supplied identity header with the resolved one', () => {
    const request = {
      socket: { remoteAddress: '203.0.113.9' },
      headers: {
        [CLIENT_IP_HEADER]: '9.9.9.9',
        'x-forwarded-for': '8.8.8.8',
      } as Record<string, string | string[] | undefined>,
    };
    stampClientIdentity(request, [], SUBKEY);
    assert({
      given: 'a caller who sets the internal identity header',
      should: 'replace it with the connection identity',
      actual: request.headers[CLIENT_IP_HEADER],
      expected: '203.0.113.9',
    });
  });

  test('removes the header when no identity can be established', () => {
    const request = {
      socket: { remoteAddress: undefined },
      headers: { [CLIENT_IP_HEADER]: '9.9.9.9' } as Record<
        string,
        string | string[] | undefined
      >,
    };
    stampClientIdentity(request, [], SUBKEY);
    assert({
      given: 'a request without a peer address',
      should: 'never leave a caller-supplied identity in place',
      actual: CLIENT_IP_HEADER in request.headers,
      expected: false,
    });
  });

  test('stamps the keyed client id hash beside the identity', () => {
    const request = {
      socket: { remoteAddress: '203.0.113.9' },
      headers: { [CLIENT_ID_HASH_HEADER]: UNKEYED } as Record<
        string,
        string | string[] | undefined
      >,
    };
    stampClientIdentity(request, [], SUBKEY);
    assert({
      given: 'a resolved client and a caller-forged hash header',
      should: 'replace it with the keyed hash of the resolved identity',
      actual: request.headers[CLIENT_ID_HASH_HEADER],
      expected: KEYED,
    });
  });

  test('removes the hash header when no identity can be established', () => {
    const request = {
      socket: { remoteAddress: undefined },
      headers: { [CLIENT_ID_HASH_HEADER]: UNKEYED } as Record<
        string,
        string | string[] | undefined
      >,
    };
    stampClientIdentity(request, [], SUBKEY);
    assert({
      given: 'a request without a peer address and a forged hash header',
      should: 'never leave the caller-supplied hash in place',
      actual: CLIENT_ID_HASH_HEADER in request.headers,
      expected: false,
    });
  });

  test("stamps Fly's authoritative header when the peer is a trusted fly-proxy hop", () => {
    const request = {
      socket: { remoteAddress: 'fdaa::1' },
      headers: {
        [FLY_CLIENT_IP_HEADER]: '203.0.113.9',
        'x-forwarded-for': '6.6.6.6, 198.51.100.4',
      } as Record<string, string | string[] | undefined>,
    };
    stampClientIdentity(request, ['fdaa::/8'], SUBKEY);
    assert({
      given:
        'a trusted fly-proxy peer forwarding Fly-Client-IP and X-Forwarded-For',
      should:
        'stamp the identity header from Fly-Client-IP, not the forwarded chain',
      actual: request.headers[CLIENT_IP_HEADER],
      expected: '203.0.113.9',
    });
  });

  test('never honors a caller-forged Fly-Client-IP from an untrusted peer', () => {
    const request = {
      socket: { remoteAddress: '203.0.113.9' },
      headers: {
        [FLY_CLIENT_IP_HEADER]: '198.51.100.4',
      } as Record<string, string | string[] | undefined>,
    };
    stampClientIdentity(request, ['fdaa::/8'], SUBKEY);
    assert({
      given: 'a direct, untrusted caller forging Fly-Client-IP',
      should: 'stamp the connection identity, ignoring the forged header',
      actual: request.headers[CLIENT_IP_HEADER],
      expected: '203.0.113.9',
    });
  });
});
