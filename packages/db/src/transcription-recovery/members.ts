import { eq } from 'drizzle-orm';
import type { BoundedTransactionContext } from '../transaction-context';
import { necessaryEvidence as evidence } from '../schema/necessary-evidence';
import { transcriptionRecoverySources as sources } from '../schema/transcription-recovery';
/** Complete bounded immutable manifest plus current no-use facts; never ciphertext or execution secrets. */
export function members(tx: BoundedTransactionContext, contextId: string) {
  return tx
    .select({
      evidenceId: sources.evidenceId,
      sourceKey: sources.sourceKey,
      startOffsetMs: sources.startOffsetMs,
      durationMs: sources.durationMs,
      firstSequence: sources.firstSequence,
      lastSequence: sources.lastSequence,
      roundId: evidence.roundId,
      originalRoundId: evidence.originalRoundId,
      segmentId: evidence.segmentId,
      roundParticipantId: evidence.roundParticipantId,
      authorityId: evidence.authorityId,
      subjects: evidence.originalSubjectActorIds,
      speaker: evidence.originalSpeaker,
      bindingDigest: evidence.bindingDigest,
      state: evidence.state,
      expiresAt: evidence.expiresAt,
      payloadAcceptedAt: evidence.payloadAcceptedAt,
    })
    .from(sources)
    .innerJoin(evidence, eq(evidence.id, sources.evidenceId))
    .where(eq(sources.contextId, contextId))
    .orderBy(sources.firstSequence, sources.evidenceId)
    .limit(129);
}
