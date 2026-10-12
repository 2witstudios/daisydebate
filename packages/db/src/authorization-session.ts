import { sql } from 'drizzle-orm';
import { idSchema } from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
import {
  loadAuthorizationAccount,
  readAuthorizationActors,
  type AuthorizationTransaction,
} from './authorization';
import type { authorizationAccountFact } from './authorization-account';
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
  tx: AuthorizationTransaction,
  input: AuthorizationSessionInput,
) {
  return checkedSession(tx, input);
}
async function checkedSession(
  tx: AuthorizationTransaction,
  input: RealtimeSessionInput & { readonly userId?: string },
) {
  const requested = sessionInstant(input);
  const rows = (await tx.execute(
    sql`select user_id as "userId",expires_at as "expiresAt", clock_timestamp() as "databaseNow" from session where id=${input.sessionId}`,
  )) as unknown as { userId: string; expiresAt: Date; databaseNow: Date }[];
  const session = rows[0];
  if (
    !session ||
    !sessionUserMatches(session.userId, input) ||
    !(session.expiresAt instanceof Date) ||
    !(session.databaseNow instanceof Date) ||
    !Number.isFinite(session.databaseNow.getTime()) ||
    // Neither the injected edge instant nor database time may extend eligibility.
    !(
      session.expiresAt.getTime() >
      Math.max(session.databaseNow.getTime(), requested)
    )
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
  const instant = Date.parse(input.now);
  if (
    ![
      input.sessionId,
      input.actorId,
      ...(input.userId === undefined ? [] : [input.userId]),
    ].every((id) => idSchema.safeParse(id).success) ||
    !Number.isFinite(instant)
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
  readonly database: Pick<
    import('drizzle-orm/bun-sql/postgres').BunSQLDatabase,
    'transaction'
  >;
}) {
  const withSession = async (
    input: RealtimeSessionInput & { readonly userId?: string },
  ) => {
    sessionInstant(input);
    return database.transaction(async (tx) => {
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
