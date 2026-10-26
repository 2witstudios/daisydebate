/**
 * Admin bearer secrets (ADR 0076, the ADR 0019 amendment): enrollment and
 * session tokens and WebAuthn challenges are 32 OS CSPRNG bytes, base64url,
 * and only their SHA3-256 digest is ever stored or compared.
 */
export type RandomBytes = (length: number) => Uint8Array<ArrayBuffer>;

export const systemRandom: RandomBytes = (length) =>
  crypto.getRandomValues(new Uint8Array(length));

export const SECRET_BYTES = 32;
const secretShape = /^[A-Za-z0-9_-]{43}$/;

export const toBase64Url = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString('base64url');

export const mintSecret = (random: RandomBytes): string =>
  toBase64Url(random(SECRET_BYTES));

/** Whether untrusted input has a minted secret's exact shape. */
export const isSecret = (value: unknown): value is string =>
  typeof value === 'string' && secretShape.test(value);

export const sha3 = (text: string): string =>
  new Bun.CryptoHasher('sha3-256').update(text).digest('hex');
