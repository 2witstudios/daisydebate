type Env = Readonly<Record<string, string | undefined>>;

/** The only hosts slot tooling and test logins admit. */
export const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Whether a service URL names this machine (the only target tooling admits). */
export function isLoopbackUrl(value: string | undefined): boolean {
  try {
    return loopbackHosts.has(new URL(value ?? '').hostname);
  } catch {
    return false;
  }
}

/**
 * Why slot administration must refuse these service URLs, or undefined.
 * Slot tooling force-drops databases and unlinks namespaces, so it only
 * ever talks to the local shared stack, never a stale or remote server.
 */
export function serviceRefusal(env: Env): string | undefined {
  for (const key of [
    'DATABASE_URL',
    'REDIS_URL',
    'E2E_REDIS_URL',
    'TEST_REDIS_URL',
  ] as const) {
    const value = env[key];
    if (value === undefined) {
      if (key === 'E2E_REDIS_URL' || key === 'TEST_REDIS_URL') continue;
      return `${key} is required in .env`;
    }
    let host: string;
    try {
      host = new URL(value).hostname;
    } catch {
      return `${key} is not a valid URL`;
    }
    if (!loopbackHosts.has(host))
      return `${key} must name the local stack (localhost, 127.0.0.1 or ::1), not ${host}`;
  }
  return undefined;
}
