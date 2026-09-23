import type { SecurityClient } from './security-client';

export const noop = async () => ({ data: null, error: null });

export const clientWith = (
  overrides: Partial<SecurityClient>,
): SecurityClient => ({
  passkey: {
    listUserPasskeys: async () => ({ data: [], error: null }),
    updatePasskey: noop,
    deletePasskey: noop,
  },
  revokeOtherSessions: noop,
  signOut: noop,
  changeEmail: noop,
  ...overrides,
});

/** Stubs global fetch for one call and restores it after `run` resolves. */
export async function withFetch<T>(
  respond: (input: string, init?: RequestInit) => Response,
  run: () => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
    respond(String(input), init)) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

export const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
