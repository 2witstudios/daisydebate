import { and, desc, eq, sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import type {
  CaptureEvidenceBody,
  CaptureEvidenceSpeaker,
} from '@daisy/protocol';
import type { BoundedTransactionContext } from '../transaction-context';
import {
  transcriptionRecoveryContexts as contexts,
  transcriptionRecoverySources as sources,
} from '../schema/transcription-recovery';
import { contextBoundary } from './context';

/** The caller owns the original subjects→Round→evidence fence and validated canonical body. */
export async function register(
  tx: BoundedTransactionContext,
  body: CaptureEvidenceBody,
  admittedAt: Date,
  original: {
    readonly authorityId: string | null;
    readonly originalSubjectActorIds: readonly string[] | null;
    readonly originalSpeaker: CaptureEvidenceSpeaker | null;
  },
) {
  const [existing] = await tx
    .select({ id: sources.evidenceId })
    .from(sources)
    .where(eq(sources.evidenceId, body.evidenceId));
  if (existing) return;
  const sourceKey = new Bun.CryptoHasher('sha3-256')
    .update(
      JSON.stringify([
        body.roundId,
        body.sessionId,
        body.workerId,
        body.epoch,
        body.segmentId,
        body.roundParticipantId,
        body.trackId,
        body.intervalId,
        body.frames[0]!.clock.anchor,
        original.authorityId,
        original.originalSubjectActorIds,
        original.originalSpeaker,
      ]),
    )
    .digest('hex');
  const unit = {
    sourceKey,
    startOffsetMs: body.startOffsetMs,
    durationMs: body.durationMs,
    firstSequence: body.frames[0]!.clock.observation.sequence,
    lastSequence: body.frames.at(-1)!.clock.observation.sequence,
  };
  const [overlap] = await tx
    .select({ id: sources.evidenceId })
    .from(sources)
    .where(
      and(
        eq(sources.sourceKey, sourceKey),
        sql`${sources.firstSequence}<=${unit.lastSequence} and ${sources.lastSequence}>=${unit.firstSequence}`,
      ),
    )
    .limit(1);
  if (overlap)
    throw createAppError('CONFLICT', 'Original recovery samples overlap');
  const [current] = await tx
    .select()
    .from(contexts)
    .where(
      and(eq(contexts.sourceKey, sourceKey), eq(contexts.status, 'collecting')),
    )
    .orderBy(desc(contexts.createdAt), desc(contexts.id))
    .limit(1);
  const append = contextBoundary(current ?? null, unit) === 'append';
  const contextId = append ? current!.id : body.evidenceId;
  if (append) {
    await tx
      .update(contexts)
      .set({
        durationMs: current!.durationMs + unit.durationMs,
        lastSequence: unit.lastSequence,
        units: current!.units + 1,
        lastSourceAt: admittedAt,
      })
      .where(eq(contexts.id, contextId));
  } else {
    if (current)
      await tx
        .update(contexts)
        .set({ status: 'queued' })
        .where(eq(contexts.id, current.id));
    await tx.insert(contexts).values({
      id: contextId,
      roundId: body.roundId,
      segmentId: body.segmentId,
      roundParticipantId: body.roundParticipantId,
      ...unit,
      units: 1,
      status: 'collecting',
      lastSourceAt: admittedAt,
    });
  }
  await tx
    .insert(sources)
    .values({ evidenceId: body.evidenceId, contextId, ...unit });
}
