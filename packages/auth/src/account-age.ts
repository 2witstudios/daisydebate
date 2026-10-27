import { ageBand, type AgeBand } from './age-band';
import { ageAdmitted } from './participant-access';
import type { AccountAuthorizationFact } from './authorization';
export type AccountAgeSource = {
  readonly birthMonth: string;
  readonly revision: number;
  readonly recordedAt: string;
};
export type AccountAgeFact =
  | { readonly state: 'unknown' }
  | {
      readonly state: 'known';
      readonly actorId: string;
      readonly band: AgeBand;
      readonly revision: number;
      readonly accountRevision: number;
      readonly validUntil: string;
    };
/**
 * Durable account source, never request JSON. Projection contains no birth data.
 * Trusted time is injected. Recompute at every UTC month boundary/correction;
 * source and account revisions are invalidation tokens, never cached authority.
 */
export function accountAgeFact({
  source,
  account,
  now,
}: {
  readonly source: AccountAgeSource | null;
  readonly account: AccountAuthorizationFact | null;
  readonly now: string;
}): AccountAgeFact {
  const instant = new Date(now);
  if (!source || !knownAccount(account) || !validSource(source, instant))
    return { state: 'unknown' };
  try {
    const band = ageBand(source.birthMonth, instant);
    const deadline = new Date(instant.getTime());
    deadline.setUTCDate(1);
    deadline.setUTCMonth(deadline.getUTCMonth() + 1);
    deadline.setUTCHours(0, 0, 0, 0);
    return {
      state: 'known',
      actorId: account.actorId,
      band,
      revision: source.revision,
      accountRevision: account.revision,
      validUntil: deadline.toISOString(),
    };
  } catch {
    return { state: 'unknown' };
  }
}

function knownAccount(
  account: AccountAuthorizationFact | null,
): account is AccountAuthorizationFact & { actorId: string } {
  return (
    account !== null &&
    account.member &&
    !account.erased &&
    account.actorId !== null &&
    Number.isSafeInteger(account.revision) &&
    account.revision > 0
  );
}
function validSource(source: AccountAgeSource, instant: Date) {
  const recorded = Date.parse(source.recordedAt);
  return (
    Number.isSafeInteger(source.revision) &&
    source.revision > 0 &&
    Number.isFinite(instant.getTime()) &&
    Number.isFinite(recorded) &&
    recorded <= instant.getTime()
  );
}

/**
 * Whether a canonical age fact lets this actor give optional onboarding
 * answers now: known, bound to the same actor, at the account floor by
 * the one participant age rule (`ageAdmitted`, ACCOUNT_AGE_FLOOR: 16 in
 * the beta, DEC-106), and still current (it expires at the next UTC
 * month). Anything else refuses; no client-supplied age is ever an input.
 */
export function admitsOptionalAnswers(
  fact: AccountAgeFact,
  actorId: string,
  now: string,
): boolean {
  const instant = Date.parse(now);
  return (
    fact.state === 'known' &&
    fact.actorId === actorId &&
    ageAdmitted(fact.band) &&
    Number.isFinite(instant) &&
    instant < Date.parse(fact.validUntil)
  );
}
