import { createHash, type Hash } from 'node:crypto';

/** Launch-owned content identity and JSON shape checks for untrusted metadata. */
export const sha256Digest = (hash: Hash) => `sha256:${hash.digest('hex')}`;
export const sha256 = (bytes: Uint8Array | string) =>
  sha256Digest(createHash('sha256').update(bytes));
export const isDigest = (value: unknown): value is string =>
  typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
export const same = (actual: unknown, expected: unknown) =>
  JSON.stringify(actual) === JSON.stringify(expected);
export const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const plainWord = /^[A-Za-z][A-Za-z'-]{0,31}[:,.;]?$/;

/**
 * Exit code and docker's last stderr line, allowlisted to plain words. Paths,
 * URLs, assignments and digests hold digits or punctuation, so they never pass.
 */
export function dockerFailureSummary(code: number, stderr: string) {
  const last = stderr.trim().split(/\r?\n/).at(-1) ?? '';
  const summary = last
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => (plainWord.test(token) ? token : '…'))
    .filter((token, index, all) => token !== '…' || all[index - 1] !== '…')
    .join(' ')
    .slice(0, 180);
  return summary ? `exit ${code}: ${summary}` : `exit ${code}`;
}
