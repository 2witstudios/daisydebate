import { sql } from 'drizzle-orm';
import { idSchema } from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
import {
  loadAuthorizationAccount,
  lockAuthorizationActors,
  type AuthorizationTransaction,
} from './authorization';
import type { authorizationAccountFact } from './authorization-account';
type AuthorizationSessionInput = {
  readonly sessionId: string;
  readonly userId: string;
  readonly actorId: string;
  readonly now: string;
};
/** Ticket identities are hints: reread their exact durable session and account inside the caller's fenced transaction. */
export async function loadAuthorizationSession(
  tx: AuthorizationTransaction,
  input: AuthorizationSessionInput,
) {
  const instant = sessionInstant(input);
  const rows = (await tx.execute(
    sql`select user_id as "userId",expires_at as "expiresAt" from session where id=${input.sessionId}`,
  )) as unknown as { userId: string; expiresAt: Date }[];
  const session = rows[0];
  if (
    !session ||
    session.userId !== input.userId ||
    !(session.expiresAt instanceof Date) ||
    !(session.expiresAt.getTime() > instant)
  )
    return null;
  const account = await loadAuthorizationAccount(tx, input.userId);
  if (!currentSessionAccount(account, input.actorId)) return null;
  return {
    sessionId: input.sessionId,
    userId: input.userId,
    actorId: input.actorId,
    expiresAt: session.expiresAt.toISOString(),
    account,
  };
}

function sessionInstant(input: AuthorizationSessionInput): number {
  const instant = Date.parse(input.now);
  if (
    ![input.sessionId, input.userId, input.actorId].every(
      (id) => idSchema.safeParse(id).success,
    ) ||
    !Number.isFinite(instant)
  )
    throw createAppError('VALIDATION');
  return instant;
}

function currentSessionAccount(
  account: ReturnType<typeof authorizationAccountFact>,
  actorId: string,
): account is NonNullable<ReturnType<typeof authorizationAccountFact>> {
  return (
    account !== null &&
    account.member &&
    !account.erased &&
    account.actorId === actorId &&
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
  return {
    readAuthorizationSession: async (input: AuthorizationSessionInput) => {
      sessionInstant(input);
      return database.transaction(async (tx) => {
        await lockAuthorizationActors(tx, [input.actorId], { maxActors: 1 });
        return loadAuthorizationSession(tx, input);
      });
    },
  };
}
