import { eq } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import type { BoundedTransactionContext } from '../transaction-context';
import { lockOriginalNecessaryEvidence } from '../necessary-evidence-subjects';
import { requireRoundEvidenceOpen } from '../necessary-evidence-rounds';
import { requireEvidenceFrontierOpen } from '../necessary-evidence-frontier';
import { rounds } from '../schema/rounds';
import { transcriptionRecoveryContexts as contexts } from '../schema/transcription-recovery';
import { members } from './members';

/** Frozen original content subjects are discovered before accounts→Round. Never add/upgrade account locks after Round. */
export async function lock(
  tx: BoundedTransactionContext,
  contextId: string,
  roundId: string,
) {
  const [initial] = await tx
    .select()
    .from(contexts)
    .where(eq(contexts.id, contextId));
  if (!initial || initial.roundId !== roundId) throw createAppError('CONFLICT');
  const original = await members(tx, contextId),
    first = original[0];
  if (
    !first ||
    original.length !== initial.units ||
    original.length > 128 ||
    !first.subjects ||
    !first.speaker ||
    !first.authorityId ||
    original.some(
      (unit) =>
        unit.roundId !== roundId ||
        unit.originalRoundId !== roundId ||
        unit.segmentId !== initial.segmentId ||
        unit.roundParticipantId !== initial.roundParticipantId ||
        unit.sourceKey !== initial.sourceKey ||
        JSON.stringify(unit.subjects) !== JSON.stringify(first.subjects) ||
        JSON.stringify(unit.speaker) !== JSON.stringify(first.speaker) ||
        unit.authorityId !== first.authorityId,
    )
  )
    throw createAppError('CONFLICT', 'Original recognition scope is unproven');
  await lockOriginalNecessaryEvidence(tx, {
    roundId,
    evidenceId: first.evidenceId,
  });
  await requireRoundEvidenceOpen(tx, roundId);
  await requireEvidenceFrontierOpen(tx, roundId);
  const [round] = await tx
    .select({ status: rounds.status })
    .from(rounds)
    .where(eq(rounds.id, roundId));
  if (round?.status !== 'active') throw createAppError('CONFLICT');
  const [current] = await tx
    .select()
    .from(contexts)
    .where(eq(contexts.id, contextId))
    .for('update');
  const latest = await members(tx, contextId);
  const keys = [
    'id',
    'roundId',
    'segmentId',
    'roundParticipantId',
    'sourceKey',
    'startOffsetMs',
    'durationMs',
    'firstSequence',
    'lastSequence',
    'units',
  ] as const;
  if (
    !current ||
    keys.some((key) => initial[key] !== current[key]) ||
    JSON.stringify(original) !== JSON.stringify(latest)
  )
    throw createAppError('CONFLICT', 'Original recognition manifest changed');
  return { context: current, members: latest };
}
