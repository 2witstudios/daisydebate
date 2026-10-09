import type { SocialAccountFact } from './authorization-facts';
/** Validate the current minimal projection, not merely a previously minted proof. */
export function currentAgeFact(row: SocialAccountFact, now: string): boolean {
  if (row.age.state !== 'known') return false;
  const age = row.age;
  const expiry = Date.parse(age.validUntil);
  return (
    age.actorId === row.account.actorId &&
    age.accountRevision === row.account.revision &&
    Number.isSafeInteger(age.revision) &&
    age.revision > 0 &&
    Number.isFinite(expiry) &&
    expiry > Date.parse(now)
  );
}
