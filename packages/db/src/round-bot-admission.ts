import { roundHasAiJudge } from './round-ai-judge';
import { and, eq, sql } from 'drizzle-orm';
import { createAppError, createRefusal } from '@daisy/errors';
import type { BoundedTransaction } from './bounded-transaction';
import type { BoundedTransactionContext } from './transaction-context';
import { lockAuthorizationActors } from './authorization';
import { rounds } from './schema/rounds';
import { usageReservations } from './schema/usage-reservations';
import {
  requireAdmissionTarget,
  requireSponsor,
} from './round-usage-authority';
import {
  reserveUsageLocked,
  readAllowanceLocked,
  advanceUsageLocked,
  type AllowancePolicy,
  type AllowanceAccountPolicy,
} from './usage-ledger';
import { usageStateSchema } from '@daisy/protocol/billing';
export {
  refundUnservedPracticeLocked,
  refundPlatformEndedLocked,
} from './round-usage-settlement';

type Target = { readonly actorId: string; readonly roundId: string };
type Reservation = Target & { readonly id: string };
/** Global bot capacity precedes canonical account then Room/Round and usage fences. */
export const lockBotAdmission = (tx: BoundedTransactionContext) =>
  tx.execute(sql`select pg_advisory_xact_lock(59003, 1)`);
async function lockSponsor(tx: BoundedTransactionContext, target: Target) {
  requireAdmissionTarget(target);
  const [account] = await lockAuthorizationActors(tx, [target.actorId], {
    maxActors: 1,
  });
  const [round] = await tx
    .select()
    .from(rounds)
    .where(eq(rounds.id, target.roundId))
    .for('no key update');
  requireSponsor(account ?? null, round, target.actorId);
  return account ?? null;
}

/** First model-call count and provider-run creation share the caller's transaction. */
export async function markLockedRoundBotModelCall(
  tx: BoundedTransactionContext,
  input: {
    readonly roundId: string;
    readonly before: string;
    readonly accountEligible: AllowanceAccountPolicy;
  },
) {
  const [round] = await tx
    .select({ actorId: rounds.createdByActorId })
    .from(rounds)
    .where(eq(rounds.id, input.roundId));
  if (!round?.actorId) throw createAppError('AUTHORIZATION');
  const target = { roundId: input.roundId, actorId: round.actorId };
  const account = await lockSponsor(tx, target);
  if (!input.accountEligible(account)) throw createAppError('AUTHORIZATION');
  const [current] = await tx
    .select()
    .from(usageReservations)
    .where(
      and(
        eq(usageReservations.actorId, target.actorId),
        eq(usageReservations.roundId, target.roundId),
        eq(usageReservations.kind, 'ai_round'),
      ),
    );
  if (!current) throw createAppError('CONFLICT', 'Bot reservation missing');
  await advanceUsageLocked(tx, {
    ...target,
    reservationId: current.id,
    event: { kind: 'dispatch', before: input.before },
    authorized: true,
  });
  return { ...target, id: current.id };
}

/**
 * Global bot-debater capacity: live Rounds holding a bot debater seat
 * (ADR 0058). Independent of the allowance's
 * reservations; an AI judge takes no slot. `exceptRoundId` leaves out the
 * Round being frozen, whose seats are already written.
 */
const liveBotDebaterRounds = (exceptRoundId?: string) =>
  sql`select count(distinct r.id)::int from rounds r
    join round_participants p on p.round_id=r.id and p.role in ('affirmative','negative')
    join actors a on a.id=p.actor_id and a.kind='bot'
    where r.status in ('opening','active') and r.id<>${exceptRoundId ?? ''}`;

function admissionRefusal(
  decision: Awaited<ReturnType<typeof readAllowanceLocked>>['decision'],
  busy: number,
  busyCap: number,
) {
  if (decision.kind === 'refuse') {
    if (decision.reason === 'allowance') return 'allowance' as const;
    if (decision.reason === 'renewal-grace') return 'renewal-grace' as const;
    return 'not-eligible' as const;
  }
  return busy >= busyCap ? ('capacity' as const) : null;
}

/** Explicit capacity plus the single source-aware allowance policy, injected by composition. */
export function createRoundBotAdmission(input: {
  readonly run: BoundedTransaction;
  readonly nextId: () => string;
  readonly busyCap: number;
  readonly allowance: AllowancePolicy;
  readonly accountEligible: AllowanceAccountPolicy;
}) {
  requireBusyCap(input.busyCap);
  const reserveLocked = async (
    tx: BoundedTransactionContext,
    target: Target,
  ): Promise<Reservation> => {
    const account = await lockSponsor(tx, target);
    const [existing] = await tx
      .select()
      .from(usageReservations)
      .where(
        and(
          eq(usageReservations.actorId, target.actorId),
          eq(usageReservations.roundId, target.roundId),
          eq(usageReservations.kind, 'ai_round'),
        ),
      );
    const rows = await reserveUsageLocked(tx, {
      account,
      nextId: input.nextId,
      decide: input.allowance,
      accountEligible: input.accountEligible,
      request: {
        kind: 'bot_debate',
        roundId: target.roundId,
        withJudge: await roundHasAiJudge(tx, target.roundId),
      },
    });
    if (!existing) {
      const [row] = await tx.execute(liveBotDebaterRounds(target.roundId));
      if (Number((row as { count: number }).count) >= input.busyCap)
        throw createRefusal('CONFLICT', 'bots-busy');
    }
    const bot = rows.find((row) => row.kind === 'ai_round');
    if (
      !bot ||
      ['refunded', 'credited', 'released', 'definite_failure'].includes(
        usageStateSchema.parse(bot.state).kind,
      )
    )
      throw createAppError('CONFLICT', 'Bot request terminal');
    return { ...target, id: bot.id };
  };
  return {
    lock: lockBotAdmission,
    readStatus: (actorId: string) =>
      input.run(async (tx) => {
        const [account] = await lockAuthorizationActors(tx, [actorId], {
          maxActors: 1,
        });
        const [{ count: busy }] = (await tx.execute(
          liveBotDebaterRounds(),
        )) as unknown as [{ count: number }];
        // Preview never establishes binding or grants dispatch authority.
        const result = await readAllowanceLocked(tx, {
          account: account ?? null,
          request: { kind: 'bot_debate', roundId: null, withJudge: false },
          decide: input.allowance,
        });
        const reservation = result.quote?.reservations[0];
        const limit = reservation?.limit ?? 0;
        const spent = result.facts.usage[0]?.spent ?? 0;
        const refusal = admissionRefusal(result.decision, busy, input.busyCap);
        return {
          limit,
          remaining: Math.max(0, limit - spent),
          source: reservation?.source ?? null,
          refusal,
        };
      }),
    reserveLocked,
    reserve: (target: Target) =>
      input.run(async (tx) => {
        await lockBotAdmission(tx);
        return reserveLocked(tx, target);
      }),
  };
}
export type RoundBotAdmission = ReturnType<typeof createRoundBotAdmission>;
export type BotAdmissionStatus = Awaited<
  ReturnType<RoundBotAdmission['readStatus']>
>;

function requireBusyCap(busyCap: number): void {
  if (!Number.isSafeInteger(busyCap) || busyCap < 1)
    throw createAppError(
      'VALIDATION',
      'Explicit positive bot capacity required',
    );
}
