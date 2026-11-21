import { tryInstantMs, instantMs } from '@daisy/clock';
import type { EntitlementGrant } from '@daisy/protocol';
import type {
  AllowanceDecision,
  AllowanceFacts,
  AllowanceRequest,
  BillingAccess,
  UsageKind,
  UsageSource,
} from '@daisy/protocol/billing';
import { allowanceDay, requestedUsageKinds } from '@daisy/protocol/billing';
import { subscriptionAccess } from './subscription-policy';
import { participantAccess } from './participant-access';
import type { AccountAuthorizationFact } from './authorization-facts';
import {
  allowanceCeilings,
  type AllowanceCeilings,
} from './allowance-ceilings';
import {
  currentEntitlementGrants,
  type EntitlementEvaluation,
} from './entitlement-validity';

type Policy = EntitlementEvaluation & {
  /** Tests may tighten the trusted ceilings; production uses the one config. */
  readonly ceilings?: AllowanceCeilings;
};
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
    case 'organization_seat':
      return (
        right.kind === 'organization_seat' &&
        left.organizationId === right.organizationId &&
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
  // A club seat (ADR 0148) funds use the member does not pay for themselves.
  const seat = grants.find(
    (grant) =>
      grant.source === 'organization_seat' &&
      grant.entitlement === entitlementOf[primary],
  );
  if (seat?.source === 'organization_seat')
    return {
      kind: 'organization_seat',
      organizationId: seat.organizationId,
      startsAt: seat.startsAt,
      endsAt: seat.expiresAt,
    };
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

/** Free is the lifetime source; a subscription, club seat or beta grant is Premium. */
export type AllowanceTier = 'free' | 'premium';
export type AllowanceVerdict = 'allow' | 'free-limit-reached' | 'abuse-ceiling';

/**
 * The whole quantity rule (PYL-10): a free account has one use of each kind,
 * ever; Premium is unlimited up to the per-day abuse ceiling. Counts enter
 * here and only the verdict leaves.
 */
export function allowanceVerdict(
  input: {
    readonly tier: AllowanceTier;
    readonly kind: UsageKind;
    readonly usedToday: number;
    readonly usedThisPeriod: number;
  },
  ceilings: AllowanceCeilings = allowanceCeilings,
): AllowanceVerdict {
  if (input.tier === 'free')
    return input.usedThisPeriod >= ceilings.freeLifetime
      ? 'free-limit-reached'
      : 'allow';
  return input.usedToday >= ceilings.premiumPerDay[input.kind]
    ? 'abuse-ceiling'
    : 'allow';
}

const counts = (entries: readonly { readonly spent: number }[]) =>
  entries.every(
    (entry) => Number.isSafeInteger(entry.spent) && entry.spent >= 0,
  );
function validFacts(facts: AllowanceFacts, policy: Policy): boolean {
  return (
    tryInstantMs(policy.now) !== undefined &&
    counts(facts.usage) &&
    (facts.today === null || counts(facts.today.usage))
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
/** The first refusing verdict across the bundle; a bundle admits whole or not at all. */
function bundleVerdict(
  facts: AllowanceFacts,
  source: UsageSource,
  kinds: readonly UsageKind[],
  policy: Policy,
): AllowanceVerdict {
  const today =
    facts.today?.startsAt === allowanceDay(policy.now).startsAt
      ? facts.today.usage
      : [];
  const sum = (entries: readonly { kind: UsageKind; spent: number }[]) =>
    entries.reduce((total, entry) => total + entry.spent, 0);
  for (const kind of kinds) {
    const verdict = allowanceVerdict(
      {
        tier: source.kind === 'lifetime' ? 'free' : 'premium',
        kind,
        usedToday: sum(today.filter((entry) => entry.kind === kind)),
        usedThisPeriod: sum(
          facts.usage.filter(
            (entry) =>
              entry.kind === kind && sameUsageSource(entry.source, source),
          ),
        ),
      },
      policy.ceilings,
    );
    if (verdict !== 'allow') return verdict;
  }
  return 'allow';
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
  const now = instantMs(policy.now);
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
  // A free judge already bound to another Round is used; with no binding yet,
  // it can only come with the free bot Round.
  if (freeJudgeUnbound(source, request, facts))
    return refuse(
      facts.freeBotRoundId === null
        ? 'free-judge-unbound'
        : 'free-limit-reached',
    );
  const verdict = bundleVerdict(facts, source, kinds, policy);
  return verdict === 'allow'
    ? { kind: 'admit', reservations: kinds.map((kind) => ({ kind, source })) }
    : refuse(verdict);
}
