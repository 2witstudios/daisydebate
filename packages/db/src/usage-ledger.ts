import { and, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import type {
  AllowanceDecision,
  AllowanceFacts,
  AllowanceRequest,
  UsageEvent,
} from '@daisy/protocol/billing';
import {
  advanceUsage,
  allowanceDay,
  usageHoldingStates,
  requestedUsageKinds,
  usageKindSchema,
  usageSourceSchema,
  usageStateSchema,
} from '@daisy/protocol/billing';
import type { lockAuthorizationActors } from './authorization';
import { readEntitlementGrants } from './entitlement-grants';
import { readBillingEvidence } from './billing-subscription-facts';
import { idSchema } from '@daisy/protocol/primitives';
import { readDatabaseTime } from './database-clock';
import { usageReservations } from './schema/usage-reservations';
import type { Tx } from './tx';

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

/**
 * Per requested kind, one indexed read of two counts: holding use for the
 * quoted source and for the quote's UTC day. The verdict picks the one its
 * tier needs (ADR 0146).
 */
async function readQuotedUse(
  tx: Tx,
  actorId: string,
  quote: Admission,
  now: string,
): Promise<Pick<AllowanceFacts, 'usage' | 'today'>> {
  const day = allowanceDay(now);
  const usage: AllowanceFacts['usage'][number][] = [];
  const today: NonNullable<AllowanceFacts['today']>['usage'][number][] = [];
  for (const reservation of quote.reservations) {
    const inSource = eq(usageReservations.source, reservation.source);
    const inDay = and(
      gte(usageReservations.reservedAt, new Date(day.startsAt)),
      lt(usageReservations.reservedAt, new Date(day.endsAt)),
    );
    const [row] = await tx
      .select({
        period: sql<number>`count(*) filter (where ${inSource})::int`,
        daily: sql<number>`count(*) filter (where ${inDay})::int`,
      })
      .from(usageReservations)
      .where(
        and(
          eq(usageReservations.actorId, actorId),
          eq(usageReservations.kind, reservation.kind),
          inArray(
            sql<string>`${usageReservations.state}->>'kind'`,
            usageHoldingStates,
          ),
          or(inSource, inDay),
        ),
      );
    usage.push({
      kind: reservation.kind,
      source: reservation.source,
      spent: row?.period ?? 0,
    });
    today.push({ kind: reservation.kind, spent: row?.daily ?? 0 });
  }
  return { usage, today: { startsAt: day.startsAt, usage: today } };
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

/** Account fence held; every source, period and day edge gets fresh bounded usage reads. */
export async function readAllowanceLocked(tx: Tx, input: RequestInput) {
  const account = requireAccount(input.account);
  const { request } = input;
  const facts: AllowanceFacts = {
    billing: await readBillingEvidence(tx, account.userId),
    grants: await readEntitlementGrants(tx, account.userId),
    freeBotRoundId: await currentBinding(tx, account.actorId),
    usage: [],
    today: null,
  };
  let now = (await readDatabaseTime(tx)).toISOString();
  for (let attempt = 0; attempt < 3; attempt++) {
    const quote = input.decide(account, facts, request, now);
    if (quote.kind === 'refuse')
      return { decision: quote, quote: null, facts, now };
    requireCompleteQuote(quote, request);
    const read = now;
    const usage = await readQuotedUse(tx, account.actorId, quote, read);
    now = (await readDatabaseTime(tx)).toISOString();
    // Requote after reads before using those counts: time may change the source.
    const current = input.decide(account, facts, request, now);
    if (current.kind === 'refuse')
      return { decision: current, quote: null, facts, now };
    if (
      !sameAttribution(quote, current) ||
      allowanceDay(read).startsAt !== allowanceDay(now).startsAt
    )
      continue;
    const measured = { ...facts, ...usage };
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
  tx: Tx,
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
      now: (await readDatabaseTime(tx)).toISOString(),
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
