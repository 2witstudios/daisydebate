import type { EntitlementGrant } from '@daisy/protocol';
import type {
  AllowanceDecision,
  AllowanceFacts,
  AllowanceRequest,
  BillingAccess,
  UsageKind,
  UsageSource,
} from '@daisy/protocol/billing';
import { requestedUsageKinds } from '@daisy/protocol/billing';
import { subscriptionAccess } from './subscription-policy';
import { participantAccess } from './participant-access';
import type { AccountAuthorizationFact } from './authorization-facts';
import {
  currentEntitlementGrants,
  type EntitlementEvaluation,
} from './entitlement-validity';

type Policy = EntitlementEvaluation & { readonly betaMonthlyCap: number };
type Refusal = Extract<AllowanceDecision, { kind: 'refuse' }>;
const refuse = (reason: Refusal['reason']): Refusal => ({
  kind: 'refuse',
  reason,
});

/** Identity comparison never uses reservation time or the current calendar month. */
function sameUsageSource(left: UsageSource, right: UsageSource): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case 'lifetime':
      return true;
    case 'beta':
      return (
        right.kind === 'beta' &&
        left.startsAt === right.startsAt &&
        left.endsAt === right.endsAt
      );
    case 'subscription':
      return (
        right.kind === 'subscription' &&
        left.subscriptionId === right.subscriptionId &&
        left.startsAt === right.startsAt &&
        left.endsAt === right.endsAt
      );
  }
}

const entitlementOf: Record<UsageKind, EntitlementGrant['entitlement']> = {
  ai_round: 'ai_rounds',
  casual_ai_judge: 'casual_ai_judge',
  round_analysis: 'round_analysis',
};
function sourceFor(
  access: BillingAccess,
  grants: readonly EntitlementGrant[],
  primary: UsageKind,
  now: number,
): UsageSource {
  if (access.kind !== 'none') return { kind: 'subscription', ...access.period };
  if (
    !grants.some(
      (grant) =>
        grant.source === 'beta' && grant.entitlement === entitlementOf[primary],
    )
  )
    return { kind: 'lifetime' };
  const date = new Date(now);
  return {
    kind: 'beta',
    startsAt: new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1),
    ).toISOString(),
    endsAt: new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1),
    ).toISOString(),
  };
}

function reservationLimit(
  source: UsageSource,
  kind: UsageKind,
  betaCap: number,
): number | null {
  if (source.kind === 'lifetime') return 1;
  return kind === 'ai_round'
    ? source.kind === 'subscription'
      ? 5
      : betaCap
    : null;
}

function validFacts(facts: AllowanceFacts, policy: Policy): boolean {
  return (
    Number.isFinite(Date.parse(policy.now)) &&
    Number.isSafeInteger(policy.betaMonthlyCap) &&
    policy.betaMonthlyCap > 0 &&
    facts.usage.every(
      (entry) => Number.isSafeInteger(entry.spent) && entry.spent >= 0,
    )
  );
}
function holdsRequestedGrants(
  source: UsageSource,
  kinds: readonly UsageKind[],
  grants: readonly EntitlementGrant[],
): boolean {
  return (
    source.kind === 'lifetime' ||
    kinds.every((kind) =>
      grants.some(
        (grant) =>
          grant.source === source.kind &&
          grant.entitlement === entitlementOf[kind],
      ),
    )
  );
}
function exhaustedAllowance(
  facts: AllowanceFacts,
  reservations: Extract<AllowanceDecision, { kind: 'admit' }>['reservations'],
): boolean {
  return reservations.some(
    ({ kind, source, limit }) =>
      limit !== null &&
      facts.usage
        .filter(
          (entry) =>
            entry.kind === kind && sameUsageSource(entry.source, source),
        )
        .reduce((sum, entry) => sum + entry.spent, 0) >= limit,
  );
}

export const canUseAiAllowance = (account: AccountAuthorizationFact | null) =>
  account?.member === true &&
  !account.erased &&
  account.actorId !== null &&
  participantAccess(account);
const freeJudgeUnbound = (
  source: UsageSource,
  request: AllowanceRequest,
  facts: AllowanceFacts,
) => {
  if (
    source.kind !== 'lifetime' ||
    !requestedUsageKinds(request).includes('casual_ai_judge')
  )
    return false;
  // Refunding use never transfers an existing judge binding. Only a new
  // bundle may establish the first binding; a standalone judge cannot.
  return facts.freeBotRoundId === null
    ? request.kind === 'casual_judge'
    : facts.freeBotRoundId !== request.roundId;
};

/**
 * One source selection and one all-or-nothing decision. The store serializes
 * this decision with ledger writes under the account fence. Feature capacity,
 * Round/seat authority and same-request recovery are independent gates.
 */
export function admitAllowance(
  account: AccountAuthorizationFact | null,
  facts: AllowanceFacts,
  request: AllowanceRequest,
  policy: Policy,
): AllowanceDecision {
  if (!canUseAiAllowance(account)) return refuse('not-eligible');
  if (!validFacts(facts, policy)) return refuse('invalid-facts');
  const now = Date.parse(policy.now);
  const access = facts.billing
    ? subscriptionAccess(facts.billing, policy.now)
    : ({ kind: 'none' } as const);
  if (access.kind === 'grace' && request.kind === 'bot_debate')
    return refuse('renewal-grace');
  const grants = currentEntitlementGrants(facts.grants, policy);
  const kinds = requestedUsageKinds(request);
  const source = sourceFor(access, grants, kinds[0]!, now);
  if (!holdsRequestedGrants(source, kinds, grants))
    return refuse('not-eligible');
  if (freeJudgeUnbound(source, request, facts))
    return refuse('free-judge-unbound');
  const reservations = kinds.map((kind) => ({
    kind,
    source,
    limit: reservationLimit(source, kind, policy.betaMonthlyCap),
  }));
  return exhaustedAllowance(facts, reservations)
    ? refuse('allowance')
    : { kind: 'admit', reservations };
}
