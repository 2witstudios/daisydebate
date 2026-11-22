import { tryInstantMs } from '@daisy/clock';
import { sql } from 'drizzle-orm';
import { idSchema } from '@daisy/protocol/primitives';
import { createAppError } from '@daisy/errors';
import {
  loadAuthorizationAccount,
  readAuthorizationActors,
} from './authorization';
import type { authorizationAccountFact } from './authorization-account';
import { inTransaction, type Tx, type TxOpener } from './tx';
import { query } from './raw-rows';
import { z } from 'zod';
type RealtimeSessionInput = {
  readonly sessionId: string;
  readonly actorId: string;
  readonly now: string;
};
type AuthorizationSessionInput = RealtimeSessionInput & {
  readonly userId: string;
};
/** Ticket identities are hints: reread their exact durable session and account inside the caller's fenced transaction. */
export async function loadAuthorizationSession(
  tx: Tx,
  input: AuthorizationSessionInput,
) {
  return checkedSession(tx, input);
}
type AccountFact = NonNullable<ReturnType<typeof authorizationAccountFact>>;
/**
 * Many viewers' sessions in one statement (ADR 0089 cohorts), each bound to
 * an account the caller already read inside the same fenced transaction.
 * One answer per input, in order; null is an expired, foreign or missing
 * session, or an account that is no longer the session's.
 */
export async function loadAuthorizationSessions(
  tx: Tx,
  input: {
    readonly now: string;
    readonly sessions: readonly Omit<AuthorizationSessionInput, 'now'>[];
    readonly accounts: readonly (AccountFact | null)[];
  },
) {
  const instants = input.sessions.map((session) =>
    sessionInstant({ ...session, now: input.now }),
  );
  if (input.sessions.length === 0) return [];
  const rows = await query(
    tx,
    z.object({ id: z.string(), userId: z.string(), expiresAt: z.date() }),
    sql`select id, user_id as "userId", expires_at as "expiresAt" from session where id = any(array[${sql.join(
      input.sessions.map(({ sessionId }) => sql`${sessionId}`),
      sql`, `,
    )}]::text[])`,
  );
  const byId = new Map(rows.map((row) => [row.id, row]));
  return input.sessions.map((wanted, index) => {
    const row = byId.get(wanted.sessionId);
    const account =
      input.accounts.find((fact) => fact?.actorId === wanted.actorId) ?? null;
    if (
      !row ||
      !sessionUserMatches(row.userId, { ...wanted, now: input.now }) ||
      !(row.expiresAt instanceof Date) ||
      !(row.expiresAt.getTime() > instants[index]!) ||
      !currentSessionAccount(account, wanted.actorId, row.userId)
    )
      return null;
    return {
      sessionId: wanted.sessionId,
      userId: row.userId,
      actorId: wanted.actorId,
      expiresAt: row.expiresAt.toISOString(),
      account,
    };
  });
}
async function checkedSession(
  tx: Tx,
  input: RealtimeSessionInput & { readonly userId?: string },
) {
  const instant = sessionInstant(input);
  const rows = await query(
    tx,
    z.object({ userId: z.string(), expiresAt: z.date() }),
    sql`select user_id as "userId",expires_at as "expiresAt" from session where id=${input.sessionId}`,
  );
  const session = rows[0];
  if (
    !session ||
    !sessionUserMatches(session.userId, input) ||
    !(session.expiresAt instanceof Date) ||
    !(session.expiresAt.getTime() > instant)
  )
    return null;
  const account = await loadAuthorizationAccount(tx, session.userId);
  if (!currentSessionAccount(account, input.actorId, session.userId))
    return null;
  return {
    sessionId: input.sessionId,
    userId: session.userId,
    actorId: input.actorId,
    expiresAt: session.expiresAt.toISOString(),
    account,
  };
}

function sessionUserMatches(
  userId: string,
  input: RealtimeSessionInput & { readonly userId?: string },
): boolean {
  return (
    idSchema.safeParse(userId).success &&
    (input.userId === undefined || input.userId === userId)
  );
}
function sessionInstant(
  input: RealtimeSessionInput & { readonly userId?: string },
): number {
  const instant = tryInstantMs(input.now);
  if (
    ![
      input.sessionId,
      input.actorId,
      ...(input.userId === undefined ? [] : [input.userId]),
    ].every((id) => idSchema.safeParse(id).success) ||
    instant === undefined
  )
    throw createAppError('VALIDATION');
  return instant;
}

function currentSessionAccount(
  account: ReturnType<typeof authorizationAccountFact>,
  actorId: string,
  userId: string,
): account is NonNullable<ReturnType<typeof authorizationAccountFact>> {
  return (
    account !== null &&
    account.member &&
    !account.erased &&
    account.actorId === actorId &&
    account.userId === userId &&
    Number.isSafeInteger(account.revision) &&
    account.revision > 0
  );
}

/** Pool binding owns the account fence; app callers receive checked facts, never the transaction. */
export function authorizationSessionOperations({
  database,
}: {
  readonly database: TxOpener;
}) {
  const withSession = async (
    input: RealtimeSessionInput & { readonly userId?: string },
  ) => {
    sessionInstant(input);
    return inTransaction(database, async (tx) => {
      await readAuthorizationActors(tx, [input.actorId], { maxActors: 1 });
      return checkedSession(tx, input);
    });
  };
  return {
    resolveRealtimeSession: (input: RealtimeSessionInput) => withSession(input),
    readAuthorizationSession: (input: AuthorizationSessionInput) =>
      withSession(input),
  };
}
