import { idSchema } from '@daisy/protocol';
import {
  matchOperatorRoute,
  operatorAudienceSchema,
  operatorHeaders,
  operatorKeyIdSchema,
  operatorLimits,
  operatorNonceSchema,
  operatorRoutes,
  operatorSignatureVersion,
} from '@daisy/protocol/operator';

/**
 * The signed internal operator API's request signature (ADR 0079). The
 * admin app signs and the participant app verifies with this one module.
 * Pure: time, keys, nonces and the hash primitives are injected; nothing
 * here reads a clock, the environment or the network.
 *
 * Canonical string, UTF-8 lines joined by `\n`, no trailing newline:
 *
 *   DAISY-OPERATOR-V1
 *   <audience>      daisy-web:(staging|production|local), configured, never read from the request
 *   <method>        GET | PUT, per route
 *   <path>          the raw path, one of the operator routes
 *   <query>         the route's keys only, each at most once, sorted, RFC 3986 encoded, '&'-joined
 *   <kid>           [a-z0-9]{3,32}
 *   <timestamp>     13-digit epoch milliseconds
 *   <nonce>         22 base64url characters (16 CSPRNG bytes)
 *   <operatorRef>   the admin operator id
 *   <body-sha256>   lowercase hex SHA-256 of the raw body bytes
 *
 * The signature is `v1=` and the base64url HMAC-SHA256 of that string.
 */
export type OperatorRequestParts = {
  readonly audience: string;
  readonly method: string;
  readonly path: string;
  /** Query pairs in arrival order; duplicates are refused, never merged. */
  readonly query: readonly (readonly [string, string])[];
  readonly keyId: string;
  readonly timestamp: string;
  readonly nonce: string;
  readonly operatorRef: string;
  readonly body: Uint8Array;
};

/** The hash primitives, injected at the edge (`node:crypto` in each app). */
export type OperatorCrypto = {
  /** Base64url HMAC-SHA256 of the UTF-8 text under the key. */
  readonly hmacSha256: (key: Uint8Array, text: string) => string;
  readonly sha256Hex: (bytes: Uint8Array) => string;
  /** SHA3-256 of the UTF-8 text, for comparing fixed-format secrets. */
  readonly sha3Hex: (text: string) => string;
};

const rfc3986 = (value: string) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/** The canonical string, or null when any part breaks the grammar. */
export function canonicalOperatorRequest(
  parts: OperatorRequestParts,
  crypto: Pick<OperatorCrypto, 'sha256Hex'>,
): string | null {
  const route = matchOperatorRoute(parts.method, parts.path);
  if (!route) return null;
  const allowed: readonly string[] = operatorRoutes[route.route].query;
  const keys = parts.query.map(([key]) => key);
  if (
    new Set(keys).size !== keys.length ||
    keys.some((key) => !allowed.includes(key)) ||
    !operatorAudienceSchema.safeParse(parts.audience).success ||
    !operatorKeyIdSchema.safeParse(parts.keyId).success ||
    !/^[0-9]{13}$/.test(parts.timestamp) ||
    !operatorNonceSchema.safeParse(parts.nonce).success ||
    !idSchema.safeParse(parts.operatorRef).success ||
    parts.body.byteLength > operatorLimits.bodyBytes
  )
    return null;
  const query = [...parts.query]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${rfc3986(key)}=${rfc3986(value)}`)
    .join('&');
  return [
    operatorSignatureVersion,
    parts.audience,
    parts.method,
    parts.path,
    query,
    parts.keyId,
    parts.timestamp,
    parts.nonce,
    parts.operatorRef,
    crypto.sha256Hex(parts.body),
  ].join('\n');
}

const mac = (crypto: OperatorCrypto, key: Uint8Array, canonical: string) =>
  `v1=${crypto.hmacSha256(key, canonical)}`;

/** The headers a signed request carries; throws on a request outside the grammar. */
export function signOperatorRequest(
  parts: OperatorRequestParts,
  key: Uint8Array,
  crypto: OperatorCrypto,
): Readonly<Record<string, string>> {
  const canonical = canonicalOperatorRequest(parts, crypto);
  if (canonical === null)
    throw new Error('Operator request outside the grammar');
  return {
    [operatorHeaders.keyId]: parts.keyId,
    [operatorHeaders.timestamp]: parts.timestamp,
    [operatorHeaders.nonce]: parts.nonce,
    [operatorHeaders.operator]: parts.operatorRef,
    [operatorHeaders.signature]: mac(crypto, key, canonical),
  };
}

export type OperatorVerification =
  | {
      readonly ok: true;
      readonly keyId: string;
      readonly operatorRef: string;
      readonly nonce: string;
    }
  | {
      readonly ok: false;
      readonly reason:
        'route' | 'bounds' | 'grammar' | 'key' | 'signature' | 'skew';
    };

/** Fixed-format signatures compared as SHA3-256 digests, the repository's rule. */
const sameSecret = (crypto: OperatorCrypto, left: string, right: string) =>
  crypto.sha3Hex(left) === crypto.sha3Hex(right);

const allowedHeaders = new Set<string>(Object.values(operatorHeaders));

type HeaderPairs = readonly (readonly [string, string])[];

/** The body and header size caps of ADR 0079. */
const withinBounds = (headers: HeaderPairs, body: Uint8Array) =>
  body.byteLength <= operatorLimits.bodyBytes &&
  headers.reduce(
    (total, [name, value]) => total + name.length + value.length + 4,
    0,
  ) <= operatorLimits.headerBytes;

/** The `daisy-` headers by lower-case name; null on an unknown or repeated one. */
function daisyHeaders(headers: HeaderPairs): Map<string, string> | null {
  const seen = new Map<string, string>();
  for (const [rawName, value] of headers) {
    const name = rawName.toLowerCase();
    if (!name.startsWith('daisy-')) continue;
    if (!allowedHeaders.has(name) || seen.has(name)) return null;
    seen.set(name, value);
  }
  return seen;
}

/**
 * Verifies one request in the fixed order of ADR 0079: route, bounds,
 * grammar, key, signature, then clock skew. Nothing is admitted here;
 * nonce admission and authorization follow only after `ok`.
 */
export function verifyOperatorRequest(input: {
  readonly audience: string;
  readonly method: string;
  readonly path: string;
  readonly query: readonly (readonly [string, string])[];
  readonly headers: readonly (readonly [string, string])[];
  readonly body: Uint8Array;
  readonly keys: ReadonlyMap<string, Uint8Array>;
  readonly nowMs: number;
  readonly crypto: OperatorCrypto;
}): OperatorVerification {
  if (!matchOperatorRoute(input.method, input.path))
    return { ok: false, reason: 'route' };
  if (!withinBounds(input.headers, input.body))
    return { ok: false, reason: 'bounds' };
  const seen = daisyHeaders(input.headers);
  if (seen === null) return { ok: false, reason: 'grammar' };
  const header = (name: string) => seen.get(name) ?? '';
  const parts: OperatorRequestParts = {
    audience: input.audience,
    method: input.method,
    path: input.path,
    query: input.query,
    keyId: header(operatorHeaders.keyId),
    timestamp: header(operatorHeaders.timestamp),
    nonce: header(operatorHeaders.nonce),
    operatorRef: header(operatorHeaders.operator),
    body: input.body,
  };
  const canonical = canonicalOperatorRequest(parts, input.crypto);
  const signature = header(operatorHeaders.signature);
  if (canonical === null || !/^v1=[A-Za-z0-9_-]{43}$/.test(signature))
    return { ok: false, reason: 'grammar' };
  const key = input.keys.get(parts.keyId);
  if (!key) return { ok: false, reason: 'key' };
  if (!sameSecret(input.crypto, mac(input.crypto, key, canonical), signature))
    return { ok: false, reason: 'signature' };
  if (Math.abs(input.nowMs - Number(parts.timestamp)) > operatorLimits.skewMs)
    return { ok: false, reason: 'skew' };
  return {
    ok: true,
    keyId: parts.keyId,
    operatorRef: parts.operatorRef,
    nonce: parts.nonce,
  };
}

const wellFormedKeyEntry = (
  keyId: string,
  secret: string,
  extra: readonly string[],
) =>
  extra.length === 0 &&
  operatorKeyIdSchema.safeParse(keyId).success &&
  /^[A-Za-z0-9_-]+$/.test(secret);

/**
 * `OPERATOR_API_KEYS`: comma-separated `kid:base64url` pairs, at most two,
 * each at least 32 bytes. A malformed or duplicate entry refuses the whole
 * list, so a bad configuration fails startup instead of half-loading.
 */
export function parseOperatorKeys(
  value: string,
  decodeBase64url: (text: string) => Uint8Array,
): ReadonlyMap<string, Uint8Array> {
  const entries = value.split(',').map((entry) => entry.trim());
  if (entries.length < 1 || entries.length > 2)
    throw new Error('OPERATOR_API_KEYS needs one or two keys');
  const keys = new Map<string, Uint8Array>();
  for (const entry of entries) {
    const [keyId = '', secret = '', ...extra] = entry.split(':');
    if (!wellFormedKeyEntry(keyId, secret, extra) || keys.has(keyId))
      throw new Error('OPERATOR_API_KEYS entry is malformed');
    const bytes = decodeBase64url(secret);
    if (bytes.byteLength < 32)
      throw new Error('OPERATOR_API_KEYS key is shorter than 32 bytes');
    keys.set(keyId, bytes);
  }
  return keys;
}
