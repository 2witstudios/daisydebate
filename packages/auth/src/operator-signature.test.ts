import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  canonicalOperatorRequest,
  parseOperatorKeys,
  signOperatorRequest,
  verifyOperatorRequest,
  type OperatorCrypto,
  type OperatorRequestParts,
} from './operator-signature';

setupRitewayBun();

/**
 * A deterministic stand-in for the injected primitives: a keyed FNV-1a
 * mix rendered at the real output widths. It proves the grammar, the
 * field binding and the verification order; the apps' adapter tests prove
 * the real `node:crypto` primitives.
 */
const fnv = (text: string, width: number, alphabet: string) => {
  let hash = 2166136261;
  for (const character of text)
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  let out = '';
  while (out.length < width) {
    hash = Math.imul(hash ^ out.length, 16777619) >>> 0;
    out += alphabet[hash % alphabet.length];
  }
  return out;
};
const b64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const fakeCrypto: OperatorCrypto = {
  hmacSha256: (key, text) => fnv(`${[...key].join(',')}|${text}`, 43, b64),
  sha256Hex: (bytes) => fnv([...bytes].join(','), 64, '0123456789abcdef'),
  sha3Hex: (text) => fnv(`sha3|${text}`, 64, '0123456789abcdef'),
};

const key = new Uint8Array(32).fill(7);
const keys = new Map([['k20261026', key]]);
const now = 1_793_000_000_000;
const body = new TextEncoder().encode(
  '{"v":1,"commandId":"cccccccccccccccccccccccc","state":"approved","expectedRevision":1,"adminAuditHead":"' +
    'a'.repeat(64) +
    '"}',
);
const parts: OperatorRequestParts = {
  audience: 'daisy-web:staging',
  method: 'PUT',
  path: '/operator/v1/accounts/uuuuuuuuuuuuuuuuuuuuuuuu/beta-access',
  query: [],
  keyId: 'k20261026',
  timestamp: String(now),
  nonce: 'n'.repeat(22),
  operatorRef: 'o'.repeat(24),
  body,
};
const verify = (
  overrides: Partial<Parameters<typeof verifyOperatorRequest>[0]> = {},
  signed = parts,
) =>
  verifyOperatorRequest({
    audience: 'daisy-web:staging',
    method: signed.method,
    path: signed.path,
    query: signed.query,
    headers: Object.entries(signOperatorRequest(signed, key, fakeCrypto)),
    body: signed.body,
    keys,
    nowMs: now,
    crypto: fakeCrypto,
    ...overrides,
  });

describe('operator request signature (ADR 0079)', () => {
  test('a signed request verifies and names its key, operator and nonce', () => {
    assert({
      given: 'a request signed with a configured key',
      should: 'verify, binding the key id, operator and nonce',
      actual: verify(),
      expected: {
        ok: true,
        keyId: 'k20261026',
        operatorRef: 'o'.repeat(24),
        nonce: 'n'.repeat(22),
      },
    });
  });

  test('query values are encoded strictly per RFC 3986', () => {
    const canonical = canonicalOperatorRequest(
      {
        ...parts,
        method: 'GET',
        path: '/operator/v1/accounts',
        query: [['cursor', "a!'()*b c"]],
        body: new Uint8Array(),
      },
      fakeCrypto,
    );
    assert({
      given: "a query value holding !'()* and a space",
      should:
        'percent-encode the characters encodeURIComponent leaves alone, so both sides sign the same bytes',
      actual: canonical?.split('\n')[4],
      expected: 'cursor=a%21%27%28%29%2Ab%20c',
    });
  });

  test('the canonical string binds every field in a fixed order', () => {
    const canonical = canonicalOperatorRequest(
      {
        ...parts,
        method: 'GET',
        path: '/operator/v1/accounts',
        query: [
          ['limit', '20'],
          ['access', 'pending'],
        ],
        body: new Uint8Array(),
      },
      fakeCrypto,
    );
    assert({
      given: 'a list request with unsorted query keys',
      should: 'sort the query and join every field on its own line',
      actual: canonical?.split('\n').slice(0, 9),
      expected: [
        'DAISY-OPERATOR-V1',
        'daisy-web:staging',
        'GET',
        '/operator/v1/accounts',
        'access=pending&limit=20',
        'k20261026',
        String(now),
        'n'.repeat(22),
        'o'.repeat(24),
      ],
    });
  });

  test('tampering with any signed field fails the signature', () => {
    const signedHeaders = Object.entries(
      signOperatorRequest(parts, key, fakeCrypto),
    );
    const swap = (name: string, value: string) =>
      signedHeaders.map(([header, current]): [string, string] => [
        header,
        header === name ? value : current,
      ]);
    const reasons = [
      verify({ audience: 'daisy-web:production' }),
      verify({
        path: '/operator/v1/accounts/vvvvvvvvvvvvvvvvvvvvvvvv/beta-access',
      }),
      verify({ body: new TextEncoder().encode('{"v":1}') }),
      verify({ headers: swap('daisy-operator', 'p'.repeat(24)) }),
      verify({ headers: swap('daisy-nonce', 'm'.repeat(22)) }),
      verify({ headers: swap('daisy-timestamp', String(now + 1)) }),
    ].map((result) => (result.ok ? 'ok' : result.reason));
    assert({
      given: 'a changed audience, path, body, operator, nonce and timestamp',
      should: 'refuse each as a signature mismatch',
      actual: reasons,
      expected: Array(6).fill('signature'),
    });
  });

  test('requests outside the grammar or the bounds are refused before the key', () => {
    const list = {
      ...parts,
      method: 'GET',
      path: '/operator/v1/accounts',
      query: [['access', 'pending']] as const,
      body: new Uint8Array(),
    };
    const headers = Object.entries(signOperatorRequest(list, key, fakeCrypto));
    const reasons = [
      verify({ method: 'DELETE' }),
      verify({ path: '/operator/v1/admin' }),
      verify({ body: new Uint8Array(16 * 1024 + 1) }),
      verify(
        {
          query: [
            ['access', 'pending'],
            ['access', 'approved'],
          ],
          headers,
        },
        list,
      ),
      verify({ query: [['debug', '1']], headers }, list),
      verify({
        headers: [
          ...Object.entries(signOperatorRequest(parts, key, fakeCrypto)),
          ['Daisy-Debug', '1'],
        ],
      }),
      verify({
        headers: [
          ...Object.entries(signOperatorRequest(parts, key, fakeCrypto)),
          ['Daisy-Nonce', 'm'.repeat(22)],
        ],
      }),
    ].map((result) => (result.ok ? 'ok' : result.reason));
    assert({
      given:
        'an unknown method and path, an oversize body, a duplicate and an unknown query key, an unknown and a duplicate Daisy header',
      should: 'refuse each with its stage reason',
      actual: reasons,
      expected: [
        'route',
        'route',
        'bounds',
        'grammar',
        'grammar',
        'grammar',
        'grammar',
      ],
    });
  });

  test('an unknown key and a stale clock are refused', () => {
    assert({
      given: 'a key id the verifier does not hold, and a request 31 s away',
      should: 'refuse the key, then the skew after a valid signature',
      actual: [
        verify({ keys: new Map([['other', key]]) }),
        verify({ nowMs: now + 31_000 }),
        verify({ nowMs: now - 30_000 }).ok,
      ],
      expected: [
        { ok: false, reason: 'key' },
        { ok: false, reason: 'skew' },
        true,
      ],
    });
  });
});

describe('OPERATOR_API_KEYS', () => {
  const decode = (text: string) => new Uint8Array(text.length === 43 ? 32 : 8);
  test('parses one or two well-formed keys', () => {
    assert({
      given: 'two kid:secret pairs of 32 bytes',
      should: 'load both under their ids',
      actual: [
        ...parseOperatorKeys(
          `k1a:${'a'.repeat(43)}, k2b:${'b'.repeat(43)}`,
          decode,
        ).keys(),
      ],
      expected: ['k1a', 'k2b'],
    });
  });

  test('refuses malformed, duplicate, short and excess keys', () => {
    const refusal = (value: string) => {
      try {
        parseOperatorKeys(value, decode);
        return 'loaded';
      } catch (error) {
        return (error as Error).message;
      }
    };
    assert({
      given: 'a missing secret, a duplicate id, a short key and three keys',
      should: 'refuse the whole list',
      actual: [
        refusal('k1a'),
        refusal(`k1a:${'a'.repeat(43)},k1a:${'b'.repeat(43)}`),
        refusal('k1a:short'),
        refusal(
          `k1a:${'a'.repeat(43)},k2b:${'a'.repeat(43)},k3c:${'a'.repeat(43)}`,
        ),
      ],
      expected: [
        'OPERATOR_API_KEYS entry is malformed',
        'OPERATOR_API_KEYS entry is malformed',
        'OPERATOR_API_KEYS key is shorter than 32 bytes',
        'OPERATOR_API_KEYS needs one or two keys',
      ],
    });
  });
});
