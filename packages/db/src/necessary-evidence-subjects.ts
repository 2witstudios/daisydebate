import { createAppError } from '@daisy/errors';
import {
  idSchema,
  MAX_FORMAT_SEATS,
  captureEvidenceSpeakerSchema,
} from '@daisy/protocol';
import { eq } from 'drizzle-orm';
import { readAuthorizationActors } from './authorization';
import type { BoundedTransactionContext } from './transaction-context';
import { actors } from './schema/actors';
import { roundParticipants } from './schema/round-participants';
import { rounds } from './schema/rounds';
import { necessaryEvidence } from './schema/necessary-evidence';

type Tx = BoundedTransactionContext;
async function evidenceCast(tx: Tx, roundId: string) {
  const [round] = await tx
    .select({ creator: rounds.createdByActorId })
    .from(rounds)
    .where(eq(rounds.id, roundId));
  if (!round) throw createAppError('NOT_FOUND');
  const seats = await tx
    .select({
      id: roundParticipants.id,
      actorId: roundParticipants.actorId,
      kind: actors.kind,
      role: roundParticipants.role,
      slot: roundParticipants.slot,
    })
    .from(roundParticipants)
    .innerJoin(actors, eq(actors.id, roundParticipants.actorId))
    .where(eq(roundParticipants.roundId, roundId))
    .orderBy(roundParticipants.id)
    .limit(MAX_FORMAT_SEATS + 1);
  if (seats.length > MAX_FORMAT_SEATS) throw createAppError('INVARIANT');
  return { creator: round.creator, seats };
}

/** Raw-evidence privacy fence only. Never call after Round or after a weaker fence that will be upgraded. */
export async function lockNecessaryEvidenceRound(tx: Tx, roundId: string) {
  if (!idSchema.safeParse(roundId).success) throw createAppError('VALIDATION');
  const original = await evidenceCast(tx, roundId);
  const subjects = [
    ...new Set([
      ...original.seats
        .filter((seat) => seat.kind === 'human')
        .map((seat) => seat.actorId),
      ...(original.creator === null ? [] : [original.creator]),
    ]),
  ].sort();
  await lockEvidenceSubjects(tx, subjects);
  const [round] = await tx
    .select({ id: rounds.id })
    .from(rounds)
    .where(eq(rounds.id, roundId))
    .for('no key update');
  if (!round) throw createAppError('NOT_FOUND');
  const current = await evidenceCast(tx, roundId);
  if (JSON.stringify(current) !== JSON.stringify(original))
    throw createAppError('CONFLICT', 'Evidence content subjects changed');
  return { subjects, seats: current.seats };
}

async function lockEvidenceSubjects(tx: Tx, subjects: readonly string[]) {
  if (subjects.length) {
    const facts = await readAuthorizationActors(tx, subjects, {
      maxActors: MAX_FORMAT_SEATS + 1,
    });
    // Membership/entitlement is not raw-evidence erasure. Capture authorization is checked separately.
    if (facts.some((fact) => !fact || fact.erased))
      throw createAppError('AUTHORIZATION');
  }
}

const originalScope = {
  id: necessaryEvidence.id,
  roundId: necessaryEvidence.roundId,
  originalRoundId: necessaryEvidence.originalRoundId,
  originalSubjectActorIds: necessaryEvidence.originalSubjectActorIds,
  originalSpeaker: necessaryEvidence.originalSpeaker,
  authorityId: necessaryEvidence.authorityId,
  workerId: necessaryEvidence.workerId,
  captureEpoch: necessaryEvidence.captureEpoch,
  sessionId: necessaryEvidence.sessionId,
  segmentId: necessaryEvidence.segmentId,
  roundParticipantId: necessaryEvidence.roundParticipantId,
  bindingDigest: necessaryEvidence.bindingDigest,
  reservedBytes: necessaryEvidence.reservedBytes,
  state: necessaryEvidence.state,
};
/** Original account fences precede Round; execution replacement never reads a successor cast as authority. */
export async function lockOriginalNecessaryEvidence(
  tx: Tx,
  input: { readonly roundId: string; readonly evidenceId: string },
) {
  if (
    ![input.roundId, input.evidenceId].every(
      (id) => idSchema.safeParse(id).success,
    )
  )
    throw createAppError('VALIDATION');
  const [original] = await tx
    .select(originalScope)
    .from(necessaryEvidence)
    .where(eq(necessaryEvidence.id, input.evidenceId));
  const subjects = original?.originalSubjectActorIds;
  if (
    !original ||
    original.roundId !== input.roundId ||
    original.originalRoundId !== input.roundId ||
    !['acquiring', 'retained'].includes(original.state) ||
    !idSchema.safeParse(original.authorityId).success ||
    !subjects ||
    !captureEvidenceSpeakerSchema.safeParse(original.originalSpeaker).success ||
    original.originalSpeaker?.roundParticipantId !==
      original.roundParticipantId ||
    subjects.length > MAX_FORMAT_SEATS + 1 ||
    !subjects.every(
      (id, index) =>
        idSchema.safeParse(id).success &&
        (index === 0 || subjects[index - 1]! < id),
    )
  )
    throw createAppError(
      'CONFLICT',
      'Original evidence subjects or scope are unproven',
    );
  await lockEvidenceSubjects(tx, subjects);
  const [round] = await tx
    .select({ id: rounds.id })
    .from(rounds)
    .where(eq(rounds.id, input.roundId))
    .for('no key update');
  if (!round) throw createAppError('CONFLICT');
  const [current] = await tx
    .select({
      ...originalScope,
      executionWorkerId: necessaryEvidence.executionWorkerId,
      executionEpoch: necessaryEvidence.executionEpoch,
      leaseDigest: necessaryEvidence.leaseDigest,
      leaseExpiresAt: necessaryEvidence.leaseExpiresAt,
      expiresAt: necessaryEvidence.expiresAt,
    })
    .from(necessaryEvidence)
    .where(eq(necessaryEvidence.id, input.evidenceId))
    .for('update');
  if (!current) throw createAppError('CONFLICT');
  const checked = Object.fromEntries(
    Object.keys(original).map((key) => [
      key,
      current[key as keyof typeof original],
    ]),
  );
  if (JSON.stringify(original) !== JSON.stringify(checked))
    throw createAppError('CONFLICT', 'Original evidence scope changed');
  return { original, row: current };
}
