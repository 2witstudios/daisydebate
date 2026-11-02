import { createHash } from 'node:crypto';

/** Launch-owned content identity and JSON shape checks for untrusted metadata. */
export const sha256 = (bytes: Uint8Array | string) =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
export const isDigest = (value: unknown): value is string =>
  typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
export const same = (actual: unknown, expected: unknown) =>
  JSON.stringify(actual) === JSON.stringify(expected);
export const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
