import {
  isRoundOver,
  roundStatuses,
  type RoundStatus,
} from '@daisy/protocol/round';
import { and, eq, sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import type { PlatformUsageCredit, UsageEvent } from '@daisy/protocol/billing';
import { usageStateSchema } from '@daisy/protocol/billing';
import { usageReservations } from './schema/usage-reservations';
import { advanceUsageLocked } from './usage-ledger';
import { isDebatingSeatSql } from './seat-columns';
import type { Tx } from './tx';
import { query } from './raw-rows';
import { z } from 'zod';

/** Only provider executions count, never an orchestration run or a missing response. */
async function providerOutcome(tx: Tx, roundId: string) {
  const [row] = await query(
    tx,
    z.object({ calls: z.int(), received: z.int(), failed: z.int() }),
    sql`select count(*)::int as calls,
    count(*) filter(where a.configuration_snapshot->>'providerOutcome'='received')::int as received,
    count(*) filter(where a.configuration_snapshot->>'providerOutcome'='failed')::int as failed
    from agent_runs a join round_participants p on p.id=a.round_participant_id
    where p.round_id=${roundId} and ${isDebatingSeatSql(sql`p.seat_kind`)} and a.requests>0`,
  );
  if (!row) throw createAppError('INVARIANT', 'Round usage counts are missing');
  const facts = row;
  if (facts.calls === 0 || facts.received + facts.failed !== facts.calls)
    return 'unknown' as const;
  return facts.received > 0
    ? ('delivered' as const)
    : ('definite_failure' as const);
}

async function botReservation(tx: Tx, roundId: string) {
  const [row] = await tx
    .select()
    .from(usageReservations)
    .where(
      and(
        eq(usageReservations.roundId, roundId),
        eq(usageReservations.kind, 'ai_round'),
      ),
    )
    .for('update');
  return row;
}
async function terminal(tx: Tx, roundId: string) {
  const [row] = await query(
    tx,
    z.object({
      status: z.enum(roundStatuses),
      platform_ending: z.string().nullable(),
    }),
    sql`select status,platform_ending from rounds where id=${roundId}`,
  );
  return row as
    { status: RoundStatus; platform_ending: string | null } | undefined;
}

/** Round lock held. Late accounting may finish after revocation but grants no publication authority. */
export async function refundUnservedPracticeLocked(tx: Tx, roundId: string) {
  const round = await terminal(tx, roundId);
  if (!round || !isRoundOver(round.status)) return;
  const row = await botReservation(tx, roundId);
  if (!row) return;
  const state = usageStateSchema.parse(row.state);
  if (state.kind === 'released') return;
  const event: UsageEvent =
    state.kind === 'reserved'
      ? { kind: 'abandon' }
      : { kind: 'settle', outcome: await providerOutcome(tx, roundId) };
  return advanceUsageLocked(tx, {
    reservationId: row.id,
    actorId: row.actorId,
    roundId,
    event,
    authorized: false,
  });
}

/**
 * Called only by the existing qualifying terminal writers, with their actual
 * incident or completion command. Those evidence writes and this credit commit
 * together. Row serialization and the one lifecycle preserve the first relief.
 */
export async function refundPlatformEndedLocked(
  tx: Tx,
  roundId: string,
  provenance: PlatformUsageCredit,
) {
  const round = await terminal(tx, roundId);
  if (
    !round ||
    !isRoundOver(round.status) ||
    round.platform_ending !== provenance.kind
  )
    throw createAppError(
      'CONFLICT',
      'Platform credit lacks terminal provenance',
    );
  if (provenance.kind === 'recovery_bound') {
    const rows = await query(
      tx,
      z.object({ present: z.literal(1) }),
      sql`select 1 as present from round_incidents where id=${provenance.incidentId}
      and round_id=${roundId} and ended_at is not null and resumed_at is null`,
    );
    if (rows.length !== 1)
      throw createAppError('CONFLICT', 'Incident does not authorize credit');
  }
  const row = await botReservation(tx, roundId);
  if (!row) return;
  const state = usageStateSchema.parse(row.state);
  if (state.kind === 'reserved' || state.kind === 'released') return;
  await advanceUsageLocked(tx, {
    reservationId: row.id,
    actorId: row.actorId,
    roundId,
    event: { kind: 'platform_credit', provenance },
    authorized: false,
  });
  // Honest aggregate accounting remains independent of the allowance relief.
  await refundUnservedPracticeLocked(tx, roundId);
}
