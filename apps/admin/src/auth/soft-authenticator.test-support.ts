/**
 * A software passkey for unit and integration tests: ES256, `none`
 * attestation, with every flag and the counter under the test's control.
 * Encodes just the CBOR the two ceremonies need.
 */
type Cbor = number | string | Uint8Array | ReadonlyMap<Cbor, Cbor>;

const head = (major: number, length: number): number[] => {
  if (length < 24) return [(major << 5) | length];
  if (length < 256) return [(major << 5) | 24, length];
  return [(major << 5) | 25, length >> 8, length & 255];
};
const cbor = (value: Cbor): number[] => {
  if (typeof value === 'number')
    return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (typeof value === 'string') {
    const bytes = [...new TextEncoder().encode(value)];
    return [...head(3, bytes.length), ...bytes];
  }
  if (value instanceof Uint8Array) return [...head(2, value.length), ...value];
  return [
    ...head(5, value.size),
    ...[...value].flatMap(([key, item]) => [...cbor(key), ...cbor(item)]),
  ];
};

const b64 = (bytes: ArrayBuffer | Uint8Array | number[]) =>
  Buffer.from(
    bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes,
  ).toString('base64url');
const sha256 = async (bytes: Uint8Array<ArrayBuffer>) =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
const u32 = (value: number) => [
  (value >>> 24) & 255,
  (value >>> 16) & 255,
  (value >>> 8) & 255,
  value & 255,
];
/** WebCrypto signs ECDSA as raw r ‖ s; WebAuthn carries DER. */
const der = (raw: Uint8Array): number[] => {
  const integer = (bytes: Uint8Array) => {
    let trimmed = [...bytes];
    while (trimmed.length > 1 && trimmed[0] === 0 && (trimmed[1] ?? 0) < 128)
      trimmed = trimmed.slice(1);
    if ((trimmed[0] ?? 0) >= 128) trimmed = [0, ...trimmed];
    return [2, trimmed.length, ...trimmed];
  };
  const body = [...integer(raw.slice(0, 32)), ...integer(raw.slice(32))];
  return [0x30, body.length, ...body];
};

export type Flags = {
  readonly userVerified?: boolean;
  readonly backedUp?: boolean;
};
const flagByte = (flags: Flags, attested: boolean) =>
  0x01 |
  (flags.userVerified === false ? 0 : 0x04) |
  (flags.backedUp ? 0x18 : 0) |
  (attested ? 0x40 : 0);

export type Ceremony = { readonly origin: string; readonly rpId: string };

export async function softAuthenticator(seed: number) {
  const keys = (await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
  const credentialId = new Uint8Array(16).fill(seed);
  const id = b64(credentialId);
  const coseKey = new Map<Cbor, Cbor>([
    [1, 2],
    [3, -7],
    [-1, 1],
    [-2, new Uint8Array(Buffer.from(jwk.x ?? '', 'base64url'))],
    [-3, new Uint8Array(Buffer.from(jwk.y ?? '', 'base64url'))],
  ]);
  const clientData = (type: string, challenge: string, origin: string) =>
    new TextEncoder().encode(
      JSON.stringify({ type, challenge, origin, crossOrigin: false }),
    );
  const rpHash = async (rpId: string) => [
    ...(await sha256(new TextEncoder().encode(rpId))),
  ];
  return {
    id,
    async register(challenge: string, at: Ceremony, flags: Flags = {}) {
      const authData = new Uint8Array([
        ...(await rpHash(at.rpId)),
        flagByte(flags, true),
        ...u32(0),
        ...new Array<number>(16).fill(0),
        0,
        credentialId.length,
        ...credentialId,
        ...cbor(coseKey),
      ]);
      const attestation = new Map<Cbor, Cbor>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', authData],
      ]);
      return {
        id,
        rawId: id,
        type: 'public-key' as const,
        clientExtensionResults: {},
        response: {
          clientDataJSON: b64(
            clientData('webauthn.create', challenge, at.origin),
          ),
          attestationObject: b64(cbor(attestation)),
          transports: ['internal' as const],
        },
      };
    },
    async assert(
      challenge: string,
      at: Ceremony,
      counter: number,
      flags: Flags = {},
    ) {
      const authData = new Uint8Array([
        ...(await rpHash(at.rpId)),
        flagByte(flags, false),
        ...u32(counter),
      ]);
      const data = clientData('webauthn.get', challenge, at.origin);
      const signed = new Uint8Array([...authData, ...(await sha256(data))]);
      const raw = new Uint8Array(
        await crypto.subtle.sign(
          { name: 'ECDSA', hash: 'SHA-256' },
          keys.privateKey,
          signed,
        ),
      );
      return {
        id,
        rawId: id,
        type: 'public-key' as const,
        clientExtensionResults: {},
        response: {
          clientDataJSON: b64(data),
          authenticatorData: b64(authData),
          signature: b64(der(raw)),
        },
      };
    },
  };
}
