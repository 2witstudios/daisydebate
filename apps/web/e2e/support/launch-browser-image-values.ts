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

/** Docker and errno wording. Anything else could be a path, secret or name. */
const diagnosticWords = new Set(
  `a an and at by can't cannot close connection context copy could create daemon
  deadline denied device dial directory disk docker driver eof error exceeded
  export failed failure file filesystem for from image in input/output invalid
  killed layer left memory mkdir no not of on open or out overlay2 overlayfs
  permission pipe quota read read-only refused remove rename reset response save
  short signal space stat storage such system tar temporary the timed timeout to
  too unable unexpected while with write`.split(/\s+/),
);

/**
 * Exit code and docker's last stderr line, reduced to that fixed vocabulary, so
 * only known words can reach a log or annotation.
 */
export function dockerFailureSummary(code: number, stderr: string) {
  const last = stderr.trim().split(/\r?\n/).at(-1) ?? '';
  const summary = last
    .split(/\s+/)
    .filter(Boolean)
    .map((token) =>
      diagnosticWords.has(token.replace(/[:,.;]$/, '').toLowerCase())
        ? token
        : '…',
    )
    .filter((token, index, all) => token !== '…' || all[index - 1] !== '…')
    .join(' ')
    .slice(0, 180);
  return summary ? `exit ${code}: ${summary}` : `exit ${code}`;
}
