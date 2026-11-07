import { and, eq } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import {
  canonicalCaptureEvidenceBody,
  captureEvidenceSpeakerSchema,
  type CaptureEvidenceBody,
} from '@daisy/protocol';
import { originalEvidenceBinding } from './necessary-evidence-binding';
import { lockOriginalNecessaryEvidence } from './necessary-evidence-subjects';
import { requireRoundEvidenceOpen } from './necessary-evidence-rounds';
import { sampleRoundExecutionTime } from './round-execution-time';
import type { CaptureTx } from './media-capture-context';
import { rounds } from './schema/rounds';
import { roundSegments } from './schema/round-segments';
import { roundSpeakingIntervals } from './schema/round-speaking-intervals';
import { requireEvidenceFrontierOpen } from './necessary-evidence-frontier';
/** Original authoritative history is read-only; successor capture rights never authorize these bytes. */
async function originalHistory(
  tx: CaptureTx,
  body: CaptureEvidenceBody,
  now: Date,
) {
  const [history] = await tx
    .select({
      start: roundSegments.startedAt,
      grantStart: roundSpeakingIntervals.startedAt,
      grantEnd: roundSpeakingIntervals.endedAt,
      startedVersion: roundSpeakingIntervals.startedVersion,
      currentVersion: rounds.version,
    })
    .from(roundSpeakingIntervals)
    .innerJoin(
      roundSegments,
      and(
        eq(roundSegments.id, roundSpeakingIntervals.segmentId),
        eq(roundSegments.roundId, roundSpeakingIntervals.roundId),
      ),
    )
    .innerJoin(rounds, eq(rounds.id, roundSpeakingIntervals.roundId))
    .where(
      and(
        eq(roundSpeakingIntervals.id, body.intervalId),
        eq(roundSpeakingIntervals.roundId, body.roundId),
        eq(roundSpeakingIntervals.segmentId, body.segmentId),
        eq(roundSpeakingIntervals.roundParticipantId, body.roundParticipantId),
      ),
    );
  if (
    !history ||
    history.start.getTime() !== body.segmentStartedAtMs ||
    Date.parse(body.historyReadAt) > now.getTime() ||
    body.historyVersion < history.startedVersion ||
    body.historyVersion > history.currentVersion ||
    Date.parse(body.before) < history.grantStart.getTime() ||
    (history.grantEnd && Date.parse(body.after) >= history.grantEnd.getTime())
  )
    throw createAppError('CONFLICT', 'Original evidence history is unproven');
}
/** Read-only original body authority after account→Round→intent fences; never a successor capture grant. */
export async function lockOriginalEvidenceBody(tx: CaptureTx, raw: unknown) {
  const encoded = canonicalCaptureEvidenceBody(raw);
  if (encoded.kind !== 'encoded') throw createAppError('VALIDATION');
  const { body } = encoded;
  const bodyDigest = new Bun.CryptoHasher('sha3-256')
    .update(encoded.json)
    .digest('hex');
  const current = await lockOriginalNecessaryEvidence(tx, {
    roundId: body.roundId,
    evidenceId: body.evidenceId,
  });
  await requireRoundEvidenceOpen(tx, body.roundId);
  const row = current.row;
  const binding = originalEvidenceBinding(
    {
      roundId: body.roundId,
      sessionId: body.sessionId,
      segmentId: body.segmentId,
      roundParticipantId: body.roundParticipantId,
      workerId: body.workerId,
      epoch: body.epoch,
      trackId: body.trackId,
      startOffsetMs: body.startOffsetMs,
      durationMs: body.durationMs,
      before: body.before,
      after: body.after,
      evidenceId: body.evidenceId,
      bodyDigest,
      reservedBytes: encoded.byteLength,
    },
    row.originalSubjectActorIds!,
    captureEvidenceSpeakerSchema.parse(row.originalSpeaker),
  );
  if (
    binding !== row.bindingDigest ||
    row.reservedBytes !== encoded.byteLength ||
    row.workerId !== body.workerId ||
    row.captureEpoch !== body.epoch ||
    row.sessionId !== body.sessionId ||
    row.segmentId !== body.segmentId ||
    row.roundParticipantId !== body.roundParticipantId
  )
    throw createAppError('CONFLICT', 'Original evidence body differs');
  await requireEvidenceFrontierOpen(tx, body.roundId);
  let admittedAt = new Date(await sampleRoundExecutionTime(tx));
  await originalHistory(tx, body, admittedAt);
  admittedAt = new Date(await sampleRoundExecutionTime(tx));
  return { encoded, body, bodyDigest, binding, row, admittedAt };
}
