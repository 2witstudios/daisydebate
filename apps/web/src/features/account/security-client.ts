/** Better Auth's stored passkey row, as `listUserPasskeys` returns it. */
export type PasskeyRow = {
  readonly id: string;
  readonly name?: string | null | undefined;
  readonly createdAt: string | Date;
  readonly aaguid?: string | null | undefined;
};

/** Better Auth's stored session row, as `listSessions` returns it. */
export type SessionRow = {
  readonly id: string;
  readonly token: string;
  readonly createdAt: string | Date;
  readonly updatedAt: string | Date;
  readonly expiresAt: string | Date;
  readonly userAgent?: string | null | undefined;
  readonly ipAddress?: string | null | undefined;
};

type ClientError = {
  readonly status?: number | undefined;
  readonly code?: string | undefined;
} | null;
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
  readonly listSessions: () => Result<readonly SessionRow[]>;
  readonly revokeSession: (input: {
    token: string;
  }) => Result<{ status: boolean }>;
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

/** Loads both lists in parallel; a failed side reports an empty list. */
export async function loadSecurityOverview(client: SecurityClient): Promise<{
  readonly passkeys: readonly PasskeyRow[];
  readonly sessions: readonly SessionRow[];
  readonly passkeysOutcome: SecurityOutcome;
  readonly sessionsOutcome: SecurityOutcome;
}> {
  const [passkeys, sessions] = await Promise.all([
    safely(() => client.passkey.listUserPasskeys()),
    safely(() => client.listSessions()),
  ]);
  return {
    passkeys: passkeys.data ?? [],
    sessions: sessions.data ?? [],
    passkeysOutcome: outcomeFor(passkeys.error),
    sessionsOutcome: outcomeFor(sessions.error),
  };
}

export const renamePasskey = async (
  client: SecurityClient,
  id: string,
  name: string,
): Promise<SecurityOutcome> => {
  try {
    return outcomeFor((await client.passkey.updatePasskey({ id, name })).error);
  } catch {
    return { kind: 'unavailable' };
  }
};

export const removePasskey = async (
  client: SecurityClient,
  id: string,
): Promise<SecurityOutcome> => {
  try {
    return outcomeFor((await client.passkey.deletePasskey({ id })).error);
  } catch {
    return { kind: 'unavailable' };
  }
};

export const revokeSession = async (
  client: SecurityClient,
  token: string,
): Promise<SecurityOutcome> => {
  try {
    return outcomeFor((await client.revokeSession({ token })).error);
  } catch {
    return { kind: 'unavailable' };
  }
};

export const revokeOtherSessions = async (
  client: SecurityClient,
): Promise<SecurityOutcome> => {
  try {
    return outcomeFor((await client.revokeOtherSessions()).error);
  } catch {
    return { kind: 'unavailable' };
  }
};

export const requestEmailChange = async (
  client: SecurityClient,
  newEmail: string,
): Promise<SecurityOutcome> => {
  try {
    return outcomeFor(
      (
        await client.changeEmail({
          newEmail,
          callbackURL: '/settings/security',
        })
      ).error,
    );
  } catch {
    return { kind: 'unavailable' };
  }
};
