import type {
  AccountAuthorizationFact,
  AuthorizationInput,
  ContactAuthorizationFact,
} from './authorization-facts';
/** MSG is the sole pair producer; the shared evaluator validates its projection. */
export function contactPairValid(pair: ContactAuthorizationFact): boolean {
  return (
    typeof pair.blocked === 'boolean' &&
    pair.lowActorId < pair.highActorId &&
    Number.isSafeInteger(pair.revision) &&
    pair.revision > 0
  );
}

function currentContactAccount(account: AccountAuthorizationFact): boolean {
  return (
    typeof account.userId === 'string' &&
    account.userId.length > 0 &&
    typeof account.actorId === 'string' &&
    account.actorId.length > 0 &&
    account.erased === false &&
    Number.isSafeInteger(account.revision) &&
    account.revision > 0
  );
}
export function sameAuthorizationAccount(
  a: AccountAuthorizationFact,
  b: AccountAuthorizationFact,
): boolean {
  return (
    a.userId === b.userId &&
    a.actorId === b.actorId &&
    a.revision === b.revision &&
    a.member === b.member &&
    a.erased === b.erased
  );
}
/** A safety mutation cannot recreate a relationship to an erased or unbound account. */
function contactAccountsCurrent(
  pair: ContactAuthorizationFact,
  context: AuthorizationInput['context'],
): boolean {
  const accounts = context.contactAccounts;
  if (!accounts || accounts.length !== 2 || !context.account) return false;
  if (!accounts.every(currentContactAccount)) return false;
  if (new Set(accounts.map((account) => account.userId)).size !== 2)
    return false;
  const low = accounts.find((account) => account.actorId === pair.lowActorId);
  const high = accounts.find((account) => account.actorId === pair.highActorId);
  if (!low || !high || low === high) return false;
  const self = context.account;
  return accounts.some((account) => sameAuthorizationAccount(account, self));
}

export function contactSafetyAllowed(
  actorId: string,
  pair: ContactAuthorizationFact,
  context: AuthorizationInput['context'],
): boolean {
  return (
    contactPairValid(pair) &&
    [pair.lowActorId, pair.highActorId].includes(actorId) &&
    contactAccountsCurrent(pair, context)
  );
}
