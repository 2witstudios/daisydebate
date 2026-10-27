/**
 * The browser suite's own e2e database (ADR 0075 approvals): loopback, the
 * `daisy_e2e` login and an `_e2e` database, or nothing at all.
 */
export function betaAccessTarget(
  env: Readonly<Record<string, string | undefined>>,
): string {
  const url = new URL(env.E2E_DATABASE_URL ?? 'postgres://invalid');
  if (
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.username !== 'daisy_e2e' ||
    !/^\/daisy(_wt_[a-z0-9]+)?_e2e$/.test(url.pathname)
  )
    throw new Error('Beta access approvals need the own e2e database');
  return url.toString();
}
