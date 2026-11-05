import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import type {
  AllowanceDecision,
  AllowanceFacts,
  AllowanceRequest,
  UsageEvent,
} from '@daisy/protocol/billing';
import {
  advanceUsage,
  usageHoldingStates,
  requestedUsageKinds,
  usageKindSchema,
  usageSourceSchema,
  usageStateSchema,
} from '@daisy/protocol/billing';
import type { BoundedTransactionContext } from './transaction-context';
import type { lockAuthorizationActors } from './authorization';
import { readEntitlementGrants } from './entitlement-grants';
import { readBillingEvidence } from './billing-subscription-facts';
import { idSchema } from '@daisy/protocol';
import { roundAgentNow } from './round-agent-runs';
import { usageReservations } from './schema/usage-reservations';

type Tx = BoundedTransactionContext;
type Account = Awaited<ReturnType<typeof lockAuthorizationActors>>[number];
type Admission = Extract<AllowanceDecision, { kind: 'admit' }>;
export type AllowanceAccountPolicy = (account: Account) => boolean;
export type AllowancePolicy = (
  account: Account,
  facts: AllowanceFacts,
  request: AllowanceRequest,
  now: string,
) => AllowanceDecision;
/** Shared account/source decision; feature capacity is deliberately separate. */
export type AiAllowanceOptions = {
  readonly decide: AllowancePolicy;
  readonly accountEligible: AllowanceAccountPolicy;
};
async function currentBinding(tx: Tx, actorId: string): Promise<string | null> {
  const [row] = await tx
    .select({ roundId: usageReservations.roundId })
    .from(usageReservations)
    .where(
      and(
        eq(usageReservations.actorId, actorId),
        eq(usageReservations.bindsFreeJudge, true),
        isNull(usageReservations.bindingReleasedAt),
      ),
    )
    .limit(1);
  return row?.roundId ?? null;
}

/** At most two indexed source/kind counts, independent of account history size. */
async function readQuotedUse(
  tx: Tx,
  actorId: string,
  quote: Admission,
): Promise<AllowanceFacts['usage']> {
  const usage: AllowanceFacts['usage'][number][] = [];
  for (const reservation of quote.reservations) {
    if (reservation.limit === null) continue;
    const [row] = await tx
      .select({ spent: sql<number>`count(*)::int` })
      .from(usageReservations)
      .where(
        and(
          eq(usageReservations.actorId, actorId),
          eq(usageReservations.kind, reservation.kind),
          eq(usageReservations.source, reservation.source),
          inArray(
            sql<string>`${usageReservations.state}->>'kind'`,
            usageHoldingStates,
          ),
        ),
      );
    usage.push({
      kind: reservation.kind,
      source: reservation.source,
      spent: row?.spent ?? 0,
    });
  }
  return usage;
}
function sameAttribution(left: Admission, right: Admission): boolean {
  return (
    left.reservations.length === right.reservations.length &&
    left.reservations.every((entry, index) => {
      const other = right.reservations[index];
      return (
        other?.kind === entry.kind &&
        JSON.stringify(usageSourceSchema.parse(other.source)) ===
          JSON.stringify(usageSourceSchema.parse(entry.source))
      );
    })
  );
}
function admitted(decision: AllowanceDecision): Admission {
  if (decision.kind === 'refuse')
    throw createAppError('CONFLICT', `Allowance refused: ${decision.reason}`);
  return decision;
}

type RequestInput = {
  readonly account: Account;
  readonly request: AllowanceRequest;
  readonly decide: AllowancePolicy;
};
function requireAccount(account: Account) {
  if (!account?.member || account.erased || !account.actorId)
    throw createAppError('AUTHORIZATION');
  return account as typeof account & { actorId: string };
}
function requireCompleteQuote(quote: Admission, request: AllowanceRequest) {
  const kinds = requestedUsageKinds(request);
  if (
    quote.reservations.length !== kinds.length ||
    quote.reservations.some((item, index) => item.kind !== kinds[index])
  )
    throw createAppError('INVARIANT', 'Incomplete allowance decision');
}

/** Account fence held; every source/period edge gets fresh bounded usage reads. */
export async function readAllowanceLocked(tx: Tx, input: RequestInput) {
  const account = requireAccount(input.account);
  const { request } = input;
  const facts: AllowanceFacts = {
    billing: await readBillingEvidence(tx, account.userId),
    grants: await readEntitlementGrants(tx, account.userId),
    freeBotRoundId: await currentBinding(tx, account.actorId),
    usage: [],
  };
  let now = (await roundAgentNow(tx)).toISOString();
  for (let attempt = 0; attempt < 3; attempt++) {
    const quote = input.decide(account, facts, request, now);
    if (quote.kind === 'refuse')
      return { decision: quote, quote: null, facts, now };
    requireCompleteQuote(quote, request);
    const usage = await readQuotedUse(tx, account.actorId, quote);
    now = (await roundAgentNow(tx)).toISOString();
    // Requote after reads before using those counts: time may change the source.
    const current = input.decide(account, facts, request, now);
    if (current.kind === 'refuse')
      return { decision: current, quote: null, facts, now };
    if (!sameAttribution(quote, current)) continue;
    const measured = { ...facts, usage };
    return {
      decision: input.decide(account, measured, request, now),
      quote: current,
      facts: measured,
      now,
    };
  }
  throw createAppError('CONFLICT', 'Allowance period changed during admission');
}

async function recoverUsage(
  tx: Tx,
  actorId: string,
  request: AllowanceRequest & { readonly roundId: string },
) {
  const kinds = requestedUsageKinds(request);
  const existing = await tx
    .select()
    .from(usageReservations)
    .where(
      and(
        eq(usageReservations.actorId, actorId),
        eq(usageReservations.roundId, request.roundId),
        inArray(usageReservations.kind, kinds),
      ),
    );
  if (!existing.length) return null;
  if (
    existing.length !== kinds.length ||
    existing.some((row) =>
      ['released', 'refunded', 'credited', 'definite_failure'].includes(
        usageStateSchema.parse(row.state).kind,
      ),
    )
  )
    throw createAppError('CONFLICT', 'Usage request is terminal or incomplete');
  return existing;
}

/** Whole bundle commit under account and feature/Round fences; no provider I/O. */
export async function reserveUsageLocked(
  tx: Tx,
  input: RequestInput & {
    readonly request: AllowanceRequest & { readonly roundId: string };
    readonly nextId: () => string;
    readonly accountEligible: AllowanceAccountPolicy;
  },
) {
  const account = requireAccount(input.account);
  if (!idSchema.safeParse(input.request.roundId).success)
    throw createAppError('VALIDATION');
  const existing = await recoverUsage(tx, account.actorId, input.request);
  if (existing) {
    if (!input.accountEligible(account)) throw createAppError('AUTHORIZATION');
    return existing;
  }
  const { decision, facts, now } = await readAllowanceLocked(tx, input);
  const result = admitted(decision);
  requireCompleteQuote(result, input.request);
  return tx
    .insert(usageReservations)
    .values(
      result.reservations.map((reservation) => ({
        id: input.nextId(),
        actorId: account.actorId,
        roundId: input.request.roundId,
        kind: reservation.kind,
        source: reservation.source,
        state: { kind: 'reserved' as const },
        reservedAt: new Date(now),
        bindsFreeJudge:
          reservation.kind === 'ai_round' &&
          reservation.source.kind === 'lifetime' &&
          facts.freeBotRoundId === null,
      })),
    )
    .returning();
}

/** No source/period or binding mutation is possible through provider accounting. */
export async function advanceUsageLocked(
  tx: Pick<Tx, 'select' | 'update' | 'execute'>,
  input: {
    readonly reservationId: string;
    readonly actorId: string;
    readonly roundId: string;
    readonly event: UsageEvent;
    readonly authorized: boolean;
  },
) {
  const [row] = await tx
    .select()
    .from(usageReservations)
    .where(
      and(
        eq(usageReservations.id, input.reservationId),
        eq(usageReservations.actorId, input.actorId),
        eq(usageReservations.roundId, input.roundId),
      ),
    )
    .for('update');
  if (!row) throw createAppError('AUTHORIZATION');
  const state = usageStateSchema.parse(row.state);
  const decision = advanceUsage(
    {
      kind: usageKindSchema.parse(row.kind),
      state,
      admittedAt: row.reservedAt.toISOString(),
    },
    input.event,
    {
      now: (await roundAgentNow(tx)).toISOString(),
      authorized: input.authorized,
    },
  );
  if (decision.kind === 'refuse')
    throw createAppError('CONFLICT', 'Usage transition refused');
  if (decision.kind === 'changed')
    await tx
      .update(usageReservations)
      .set({ state: decision.state })
      .where(eq(usageReservations.id, row.id));
  return decision;
}
