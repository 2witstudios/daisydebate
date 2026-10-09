import { ageBand, type AgeBand } from './age-band';
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
  if (
    !source ||
    !account?.member ||
    account.erased ||
    !account.actorId ||
    !Number.isSafeInteger(source.revision) ||
    source.revision < 1 ||
    !Number.isSafeInteger(account.revision) ||
    account.revision < 1 ||
    Number.isNaN(instant.getTime()) ||
    Number.isNaN(Date.parse(source.recordedAt)) ||
    Date.parse(source.recordedAt) > instant.getTime()
  )
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
