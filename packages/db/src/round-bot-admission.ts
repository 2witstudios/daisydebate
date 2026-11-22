import { runningRoundStatuses } from '@daisy/protocol/round';
import { lifecycleSqlList } from './lifecycle-sql';
import { z } from 'zod';
import { query } from './raw-rows';
import { roundHasAiJudge } from './round-ai-judge';
import { isDebatingSeatSql } from './seat-columns';
import { and, eq, sql } from 'drizzle-orm';
import { createAppError, createRefusal } from '@daisy/errors';
import type { BoundedTransaction } from './bounded-transaction';
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
import type { Tx } from './tx';
import { takeLock, transactionLocks } from './locks';
export {
  refundUnservedPracticeLocked,
  refundPlatformEndedLocked,
} from './round-usage-settlement';

type Target = { readonly actorId: string; readonly roundId: string };
type Reservation = Target & { readonly id: string };
/** Global bot capacity precedes canonical account then Room/Round and usage fences. */
export const lockBotAdmission = (tx: Tx) =>
  takeLock(tx, transactionLocks.botAdmission());
async function lockSponsor(tx: Tx, target: Target) {
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
  tx: Tx,
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
    join round_participants p on p.round_id=r.id and ${isDebatingSeatSql(sql`p.seat_kind`)}
    join actors a on a.id=p.actor_id and a.kind='bot'
    where r.status in ${lifecycleSqlList(runningRoundStatuses)} and r.id<>${exceptRoundId ?? ''}`;

async function countLiveBotRounds(tx: Tx, exceptRoundId?: string) {
  const [row] = await query(
    tx,
    z.object({ count: z.int() }),
    liveBotDebaterRounds(exceptRoundId),
  );
  if (!row) throw createAppError('INVARIANT', 'Bot admission count is missing');
  return row.count;
}

function admissionRefusal(
  decision: Awaited<ReturnType<typeof readAllowanceLocked>>['decision'],
  busy: number,
  busyCap: number,
) {
  if (decision.kind === 'refuse')
    switch (decision.reason) {
      case 'free-limit-reached':
      case 'abuse-ceiling':
      case 'renewal-grace':
        return decision.reason;
      case 'not-eligible':
      case 'invalid-facts':
      case 'free-judge-unbound':
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
    tx: Tx,
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
      if ((await countLiveBotRounds(tx, target.roundId)) >= input.busyCap)
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
        const busy = await countLiveBotRounds(tx);
        // Preview never establishes binding or grants dispatch authority.
        const result = await readAllowanceLocked(tx, {
          account: account ?? null,
          request: { kind: 'bot_debate', roundId: null, withJudge: false },
          decide: input.allowance,
        });
        // Only the decision leaves: never a count, limit or period (PYL-10).
        return {
          refusal: admissionRefusal(result.decision, busy, input.busyCap),
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
