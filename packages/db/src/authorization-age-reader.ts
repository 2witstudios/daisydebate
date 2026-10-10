import {
  authorizationAccountFact,
  type AuthorizationAccountRow,
} from './authorization-account';
import { loadAuthorizationAgeFact } from './authorization-age';
import type { AuthorizationTransaction } from './authorization';

/** Minimal age projection on the caller's account-fenced transaction, never an external pool. */
export const bindAuthorizationAgeFact =
  (tx: AuthorizationTransaction) =>
  async (input: AuthorizationAccountRow, now: string) => {
    const account = authorizationAccountFact(input);
    if (!account?.actorId || !account.member || account.erased)
      return { state: 'unknown' as const };
    return loadAuthorizationAgeFact(tx, {
      userId: account.userId,
      actorId: account.actorId,
      accountRevision: account.revision,
      now,
    });
  };
