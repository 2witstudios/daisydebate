import { createAppError } from '@daisy/errors';
import { idSchema, MAX_FORMAT_SEATS } from '@daisy/protocol';
import { eq } from 'drizzle-orm';
import { readAuthorizationActors } from './authorization';
import type { BoundedTransactionContext } from './transaction-context';
import { actors } from './schema/actors';
import { roundParticipants } from './schema/round-participants';
import { rounds } from './schema/rounds';

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
  if (subjects.length) {
    const facts = await readAuthorizationActors(tx, subjects, {
      maxActors: MAX_FORMAT_SEATS + 1,
    });
    // Membership/entitlement is not raw-evidence erasure. Capture authorization is checked separately.
    if (facts.some((fact) => !fact || fact.erased))
      throw createAppError('AUTHORIZATION');
  }
  const [round] = await tx
    .select({ id: rounds.id })
    .from(rounds)
    .where(eq(rounds.id, roundId))
    .for('no key update');
  if (!round) throw createAppError('NOT_FOUND');
  const current = await evidenceCast(tx, roundId);
  if (JSON.stringify(current) !== JSON.stringify(original))
    throw createAppError('CONFLICT', 'Evidence content subjects changed');
  return { subjects };
}
