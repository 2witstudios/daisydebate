import type { ClientError } from '../auth/client-error';

/** Better Auth's stored passkey row, as `listUserPasskeys` returns it. */
export type PasskeyRow = {
  readonly id: string;
  readonly name?: string | null | undefined;
  readonly createdAt: string | Date;
  readonly aaguid?: string | null | undefined;
};

/**
 * The Daisy-owned `/api/account/sessions` DTO: every field a device row
 * needs except the bearer-capable session token, which never reaches the
 * browser (AC7 — Better Auth's own `listSessions`/`revokeSession` client
 * calls carry the raw token; this app never calls them directly).
 */
export type SessionRow = {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly expiresAt: string;
  readonly userAgent: string | null;
  readonly ipAddress: string | null;
  readonly current: boolean;
};

type Result<T> = Promise<{
  readonly data: T | null;
  readonly error: ClientError;
}>;

/** The slice of the Better Auth client the settings security screen uses. */
export type SecurityClient = {
  readonly passkey: {
    readonly listUserPasskeys: () => Result<readonly PasskeyRow[]>;
    readonly updatePasskey: (input: {
      id: string;
      name: string;
    }) => Result<{ passkey: PasskeyRow }>;
    readonly deletePasskey: (input: {
      id: string;
    }) => Result<{ status: boolean }>;
  };
  readonly revokeOtherSessions: () => Result<{ status: boolean }>;
  readonly signOut: () => Result<unknown>;
  readonly changeEmail: (input: {
    newEmail: string;
    callbackURL?: string;
  }) => Result<{ status: boolean }>;
};

/** A settings action's outcome. Only `ok` did what it says. */
export type SecurityOutcome =
  | { readonly kind: 'ok' }
  | { readonly kind: 'stale-session' }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'rate-limited' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'unavailable' };

export const outcomeFor = (error: ClientError): SecurityOutcome => {
  if (error === null) return { kind: 'ok' };
  if (error.code === 'SESSION_NOT_FRESH') return { kind: 'stale-session' };
  if (error.status === 401) return { kind: 'stale-session' };
  if (error.status === 404) return { kind: 'not-found' };
  if (error.status === 409) return { kind: 'conflict' };
  if (error.status === 429) return { kind: 'rate-limited' };
  if (error.status === 400) return { kind: 'invalid' };
  return { kind: 'unavailable' };
};

const UNAVAILABLE = { data: null, error: { status: 503 } } as const;

/** Catches both a rejected promise and a synchronous throw from `call`. */
async function safely<T>(
  call: () => Result<T>,
): Promise<{ readonly data: T | null; readonly error: ClientError }> {
  try {
    return await call();
  } catch {
    return UNAVAILABLE;
  }
}

/** The `/api/account/sessions*` error body's shape (server/http.ts's toPublicError). */
type PublicErrorBody = { readonly error?: { readonly code?: string } };

/** Fetches a Daisy JSON route, mapping any non-2xx or network failure to a `ClientError`. */
async function fetchJson<T>(
  input: string,
  init?: RequestInit,
): Promise<{ readonly data: T | null; readonly error: ClientError }> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch {
    return UNAVAILABLE;
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as PublicErrorBody;
    return {
      data: null,
      error: { status: response.status, code: body.error?.code },
    };
  }
  return { data: (await response.json()) as T, error: null };
}

const listSessions = () =>
  fetchJson<{ readonly sessions: readonly SessionRow[] }>(
    '/api/account/sessions',
  );

/** Loads both lists in parallel; a failed side reports an empty list. */
export async function loadSecurityOverview(client: SecurityClient): Promise<{
  readonly passkeys: readonly PasskeyRow[];
  readonly sessions: readonly SessionRow[];
  readonly passkeysOutcome: SecurityOutcome;
  readonly sessionsOutcome: SecurityOutcome;
}> {
  const [passkeys, sessions] = await Promise.all([
    safely(() => client.passkey.listUserPasskeys()),
    listSessions(),
  ]);
  return {
    passkeys: passkeys.data ?? [],
    sessions: sessions.data?.sessions ?? [],
    passkeysOutcome: outcomeFor(passkeys.error),
    sessionsOutcome: outcomeFor(sessions.error),
  };
}

export const renamePasskey = async (
  client: SecurityClient,
  id: string,
  name: string,
): Promise<SecurityOutcome> =>
  outcomeFor(
    (await safely(() => client.passkey.updatePasskey({ id, name }))).error,
  );

export const removePasskey = async (
  client: SecurityClient,
  id: string,
): Promise<SecurityOutcome> =>
  outcomeFor((await safely(() => client.passkey.deletePasskey({ id }))).error);

export const revokeSession = async (id: string): Promise<SecurityOutcome> =>
  outcomeFor(
    (
      await fetchJson('/api/account/sessions/revoke', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      })
    ).error,
  );

export const revokeOtherSessions = async (
  client: SecurityClient,
): Promise<SecurityOutcome> =>
  outcomeFor((await safely(() => client.revokeOtherSessions())).error);

export const requestEmailChange = async (
  client: SecurityClient,
  newEmail: string,
): Promise<SecurityOutcome> =>
  outcomeFor(
    (
      await safely(() =>
        client.changeEmail({
          newEmail,
          callbackURL: '/settings/security',
        }),
      )
    ).error,
  );
