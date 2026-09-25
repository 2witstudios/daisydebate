import { createId } from '@paralleldrive/cuid2';
import type { PasskeyAccount, SessionAccount } from './provision';
import { assertPasskey } from './provision';
import { createHttpClient } from './http-client';

export type WorkloadKind = 'session-read' | 'magic-link' | 'passkey-assertion';

/**
 * The AUTH-6.7 AC4 80/10/10 mix, as an exact repeating ten-slot cycle
 * (index 0 magic-link, index 5 passkey assertion, the rest session reads)
 * rather than weighted randomness: over any run long enough to matter the
 * mix must be exactly 80/10/10, not merely converge to it.
 */
export function workloadKindFor(requestIndex: number): WorkloadKind {
  const slot = requestIndex % 10;
  if (slot === 0) return 'magic-link';
  if (slot === 5) return 'passkey-assertion';
  return 'session-read';
}

export type WorkloadOutcome = {
  readonly kind: WorkloadKind;
  readonly status: number | 'timeout' | 'error';
  readonly latencyMs: number;
};

/**
 * Runs one workload request of `kind` for `client` (its simulated identity
 * header and, for the authenticated segments, its pre-provisioned account).
 * `timeoutMs` bounds each request so a hung backend is reported as a timed
 * out outcome instead of stalling the harness's own concurrency budget.
 */
export async function runWorkloadRequest({
  http,
  originUrl,
  kind,
  clientHeader,
  sessionAccounts,
  passkeyAccounts,
  cursor,
  timeoutMs,
}: {
  readonly http: ReturnType<typeof createHttpClient>;
  readonly originUrl: string;
  readonly kind: WorkloadKind;
  readonly clientHeader: Record<string, string>;
  readonly sessionAccounts: readonly SessionAccount[];
  readonly passkeyAccounts: readonly PasskeyAccount[];
  /** A monotonically increasing counter, for picking the next account/cycle. */
  readonly cursor: number;
  readonly timeoutMs: number;
}): Promise<WorkloadOutcome> {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await runOne();
    return {
      kind,
      status: response.status,
      latencyMs: performance.now() - started,
    };
  } catch (error) {
    const latencyMs = performance.now() - started;
    if ((error as { name?: string }).name === 'AbortError')
      return { kind, status: 'timeout', latencyMs };
    return { kind, status: 'error', latencyMs };
  } finally {
    clearTimeout(timer);
  }

  async function runOne(): Promise<Response> {
    if (kind === 'session-read') {
      const account =
        sessionAccounts[cursor % Math.max(sessionAccounts.length, 1)];
      if (!account) throw new Error('No provisioned session account');
      return http.get(
        '/api/auth/get-session',
        { ...clientHeader, cookie: account.cookie },
        controller.signal,
      );
    }
    if (kind === 'magic-link') {
      const email = `auth-load-${createId()}@example.test`;
      return http.jsonPost(
        '/api/auth/sign-in/magic-link',
        { email },
        clientHeader,
        controller.signal,
      );
    }
    const account =
      passkeyAccounts[cursor % Math.max(passkeyAccounts.length, 1)];
    if (!account) throw new Error('No provisioned passkey account');
    return assertPasskey(
      http,
      originUrl,
      account.credential,
      clientHeader,
      controller.signal,
    );
  }
}
