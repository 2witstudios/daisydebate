import { authorizationAccountFact } from './authorization-account';
import { loadAuthorizationAgeFact } from './authorization-age';
import type { AuthorizationTransaction } from './authorization';

/** Minimal age projection on the caller's account-fenced transaction, never an external pool. */
export const bindAuthorizationAgeFact =
  (tx: AuthorizationTransaction) =>
  async (
    input: NonNullable<ReturnType<typeof authorizationAccountFact>>,
    now: string,
  ) => {
    // Re-checked as the producer row it came from: callers hand in facts.
    const account = authorizationAccountFact({
      ...input,
      betaState: input.beta?.state ?? null,
      betaRevision: input.beta?.revision ?? null,
    });
    if (!account?.actorId || !account.member || account.erased)
      return { state: 'unknown' as const };
    return loadAuthorizationAgeFact(tx, {
      userId: account.userId,
      actorId: account.actorId,
      accountRevision: account.revision,
      now,
    });
  };
