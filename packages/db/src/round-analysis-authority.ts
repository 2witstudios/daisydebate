import { createAppError } from '@daisy/errors';
import { idSchema, MAX_FORMAT_SEATS } from '@daisy/protocol';
import { eq, sql } from 'drizzle-orm';
import { lockAuthorizationActors, requireOwnScope } from './authorization';
import type { Caller } from './room-command-facts';
import { readRoundAnalysisAccess } from './round-analysis-access';
import { roundParticipants } from './schema/round-participants';
import { actors } from './schema/actors';
import type { Tx } from './tx';
import { run } from './raw-rows';

export type AnalysisSeat = {
  readonly roundId: string;
  readonly roundParticipantId: string;
};

/** All frozen human accounts first, in canonical order; no shared-to-exclusive upgrade. */
export async function lockAnalysisAccounts(
  tx: Tx,
  input: {
    readonly roundId: string;
    readonly roundParticipantId?: string;
    readonly caller?: Caller;
  },
) {
  if (!idSchema.safeParse(input.roundId).success)
    throw createAppError('VALIDATION');
  if (input.caller) requireOwnScope(input.caller);
  const participants = await tx
    .select({
      id: roundParticipants.id,
      actorId: roundParticipants.actorId,
      seatKind: roundParticipants.seatKind,
      userId: actors.userId,
    })
    .from(roundParticipants)
    .innerJoin(actors, eq(actors.id, roundParticipants.actorId))
    .where(eq(roundParticipants.roundId, input.roundId))
    .limit(MAX_FORMAT_SEATS + 1);
  if (participants.length > MAX_FORMAT_SEATS) throw createAppError('INVARIANT');
  const seat = participants.find((p) =>
    input.caller
      ? p.actorId === input.caller.actorId && p.userId === input.caller.userId
      : p.id === input.roundParticipantId,
  );
  // Round analysis reads a side's case: only a human side seat has one.
  if (!seat?.userId || seat.seatKind !== 'side')
    throw createAppError('NOT_FOUND');
  const accounts = await lockAuthorizationActors(
    tx,
    participants.map((p) => p.actorId),
    { maxActors: MAX_FORMAT_SEATS },
  );
  const privacy = participants.every(
    (p, index) =>
      p.userId === null ||
      (accounts[index] !== null && !accounts[index]!.erased),
  );
  const target = { roundId: input.roundId, roundParticipantId: seat.id };
  return {
    target,
    privacy,
    account: accounts[participants.indexOf(seat)] ?? null,
  };
}

/** The Round lock and fresh access facts follow canonical account fences. */
export async function lockAnalysisRound(tx: Tx, target: AnalysisSeat) {
  const [round] = await tx.execute(
    sql`select id from rounds where id=${target.roundId} for update`,
  );
  if (!round) throw createAppError('NOT_FOUND');
  return readRoundAnalysisAccess(tx, target);
}

/** Hold actual evidence against concurrent retention, refusing a conflicting purge. */
export async function lockAnalysisEvidence(tx: Tx, roundId: string) {
  await run(
    tx,
    sql`select round_id from round_transcript_freezes where round_id=${roundId} for share nowait`,
  );
  await run(
    tx,
    sql`select id from utterances where round_id=${roundId} order by id for share nowait`,
  );
}
