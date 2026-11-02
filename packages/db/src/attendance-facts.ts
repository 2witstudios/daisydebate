import { createAppError } from '@daisy/errors';
import { eq, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { lockAuthorizationActors } from './authorization';
import { actorFact } from './room-command-facts';
import { hydrateRoundRows, type RoundHydration } from './round-hydration';
import { lockedRoundVersion } from './round-projection-writer';
import { roundParticipants } from './schema/round-participants';
import {
  availabilitySamplesFrom,
  type AvailabilityEvidence,
} from './availability-operations';
import type { CheckInAttempt } from './check-in-attempts';
import { fencedActorIds, seatEligibility } from './seat-eligibility';
import { requireFencedParticipants } from './round-command-replay';
export type AttendanceTransactionContext = Pick<
  BunSQLDatabase,
  'select' | 'insert' | 'update' | 'delete' | 'execute'
>;
/** The bounded same-pool producer supplies its FIRST writer identity statement's timestamp. */
export type AttendanceTransaction = <T>(
  run: (
    tx: AttendanceTransactionContext,
    receipt: { readonly receivedAt: string },
  ) => Promise<T>,
  attempt?: CheckInAttempt,
) => Promise<T>;
export type AttendancePrincipal =
  | { readonly kind: 'human'; readonly actorId: string }
  | {
      readonly kind: 'agent';
      readonly serviceId: string;
      readonly agentRunId: string;
      readonly participantId: string;
      readonly publicationEpoch: number;
    };
export type AttendanceFacts = {
  readonly round: RoundHydration;
  readonly eligibleParticipantIds: readonly string[];
  readonly samples: readonly AvailabilityEvidence[];
  readonly finalizedSegmentIds: readonly string[];
};
export type LockedAttendanceCheckIn = AttendanceFacts & {
  readonly participantId: string;
  readonly receivedAt: string;
};

export type PrincipalColumns = {
  readonly actorId: string | null;
  readonly serviceId: string | null;
};
export const principalColumns = (
  principal: AttendancePrincipal,
): PrincipalColumns =>
  principal.kind === 'human'
    ? { actorId: principal.actorId, serviceId: null }
    : { actorId: null, serviceId: principal.serviceId };

export async function fenceAttendance(
  tx: AttendanceTransactionContext,
  roundId: string,
  commandId: string,
  principalActorId: string | null,
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${commandId},59002))`,
  );
  const initial = await tx
    .select({ actorId: roundParticipants.actorId })
    .from(roundParticipants)
    .where(eq(roundParticipants.roundId, roundId));
  const actorIds = fencedActorIds(initial, principalActorId);
  const accounts = actorIds.length
    ? await lockAuthorizationActors(tx, actorIds, {
        maxActors: actorIds.length,
      })
    : [];
  const current = await lockedRoundVersion(tx, roundId);
  const round = await hydrateRoundRows(tx, roundId);
  if (!round) throw createAppError('NOT_FOUND');
  if (round.status !== 'active')
    throw createAppError('CONFLICT', 'attendance-terminal');
  requireFencedParticipants(round.participants, actorIds);
  const seats = await Promise.all(
    round.participants.map(async (seat) => {
      const actor = await actorFact(tx, seat.actorId);
      return { ...seat, ...seatEligibility(actor, accounts, seat) };
    }),
  );
  return { current, round, seats, accounts };
}
/** The speeches already decided: an immutable fact, cheap to read under the Round lock. */
export async function finalizedAttendanceSegments(
  tx: AttendanceTransactionContext,
  roundId: string,
): Promise<readonly string[]> {
  const resolved = await tx.execute(
    sql`select segment_id from round_attendance_adjudications where round_id=${roundId}`,
  );
  return (resolved as unknown as { segment_id: string }[]).map(
    (row) => row.segment_id,
  );
}

/**
 * The samples a decision about a window opened at `from` needs. Reading from
 * the window in question, never the Round's first speech, keeps this bounded:
 * an on-time speaker settles without it and the cutoff caps how old a window
 * can get (DEC-276).
 */
export async function attendanceSamples(
  tx: AttendanceTransactionContext,
  from: string | null,
): Promise<readonly AvailabilityEvidence[]> {
  if (!from) return [];
  const samples = await tx.execute(availabilitySamplesFrom(sql, from));
  return (
    samples as unknown as {
      at: string;
      healthy: boolean;
      cause: AvailabilityEvidence['cause'];
    }[]
  ).map((row) => ({ at: row.at, healthy: row.healthy, cause: row.cause }));
}
