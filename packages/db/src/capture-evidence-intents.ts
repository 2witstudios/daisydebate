import {
  captureEvidenceSpeakerSchema,
  type CaptureEvidenceSpeaker,
} from '@daisy/protocol';
import { originalEvidenceBinding } from './necessary-evidence-binding';
import { requireRoundEvidenceOpen } from './necessary-evidence-rounds';
import { and, eq, sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import type { z } from 'zod';
import { type captureEvidenceIntentSchema } from './capture-input';
import { captureHistory } from './capture-history';
import { requireCapturedWindow } from './capture-rules';
import { nextEpoch } from './lease-policy';
import {
  captureWriteContext,
  freshCaptureMutation,
  requireCaptureSession,
  type CaptureDependencies,
  type CaptureTx,
} from './media-capture-context';
import { necessaryEvidence } from './schema/necessary-evidence';
import { lockNecessaryEvidenceRound } from './necessary-evidence-subjects';
import {
  evidenceLeaseDigest,
  evidencePolicyOf,
} from './necessary-evidence-policy';

type Intent = z.infer<typeof captureEvidenceIntentSchema>;
const sameOriginal = (
  row: typeof necessaryEvidence.$inferSelect,
  input: Intent,
  subjects: readonly string[],
  speaker: CaptureEvidenceSpeaker,
) =>
  row.authorityId === input.authorityId &&
  row.originalRoundId === input.roundId &&
  row.sessionId === input.sessionId &&
  row.segmentId === input.segmentId &&
  row.roundParticipantId === input.roundParticipantId &&
  row.workerId === input.workerId &&
  row.captureEpoch === input.epoch &&
  JSON.stringify(row.originalSubjectActorIds) === JSON.stringify(subjects) &&
  JSON.stringify(
    captureEvidenceSpeakerSchema.safeParse(row.originalSpeaker).data,
  ) === JSON.stringify(speaker) &&
  row.bindingDigest === originalEvidenceBinding(input, subjects, speaker) &&
  row.reservedBytes === input.reservedBytes;

/** Commits original authority and bounded crash discovery BEFORE custody has any side effect. */
export async function reserveCaptureEvidenceIntent(
  tx: CaptureTx,
  input: Intent,
  dependencies: CaptureDependencies,
) {
  const policy = evidencePolicyOf(dependencies);
  const { subjects, seats } = await lockNecessaryEvidenceRound(
    tx,
    input.roundId,
  );
  const seat = seats.find(
    (candidate) => candidate.id === input.roundParticipantId,
  );
  const parsedSpeaker = captureEvidenceSpeakerSchema.safeParse(
    seat && {
      roundParticipantId: seat.id,
      actorId: seat.actorId,
      kind: seat.kind,
      role: seat.role,
      slot: seat.slot,
    },
  );
  if (!parsedSpeaker.success)
    throw createAppError('CONFLICT', 'Original evidence speaker is unproven');
  const speaker = parsedSpeaker.data;
  await requireRoundEvidenceOpen(tx, input.roundId, true);
  const context = await captureWriteContext(
    tx,
    input,
    dependencies,
    new Date(input.after),
  );
  if (context.stream.state !== 'open')
    throw createAppError('CONFLICT', 'Capture stream is sealed');
  const history = await captureHistory(tx, input, context.segment);
  requireCapturedWindow(input, context.segment, context.now, history);
  // One evidence-owned admission serialization point, through the existing bounded pool.
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended('necessary-evidence-capacity',0))`,
  );
  const [existing] = await tx
    .select()
    .from(necessaryEvidence)
    .where(eq(necessaryEvidence.id, input.evidenceId))
    .for('update');
  const now = await freshCaptureMutation(tx, input.roundId, context);
  await requireCaptureSession(tx, input, {
    capturedUntil: new Date(input.after),
    receivedAt: now,
    sttLagMs: dependencies.sttLagMs,
  });
  if (existing) {
    if (
      !sameOriginal(existing, input, subjects, speaker) ||
      existing.state !== 'acquiring'
    )
      throw createAppError('CONFLICT', 'Evidence identity is fenced');
    if (existing.leaseExpiresAt && existing.leaseExpiresAt > now)
      return {
        kind: 'pending' as const,
        evidenceId: input.evidenceId,
        bindingDigest: existing.bindingDigest,
        retryAt: existing.leaseExpiresAt.toISOString(),
      };
  } else {
    const [capacity] = (await tx.execute(sql`select count(*)::integer as count,
      coalesce(sum(reserved_bytes),0)::integer as total,
      coalesce(sum(case when round_id=${input.roundId} then reserved_bytes else 0 end),0)::integer as round
      from necessary_evidence where state in ('acquiring','retained','retiring')`)) as unknown as {
      count: number;
      total: number;
      round: number;
    }[];
    if (
      !capacity ||
      capacity.count >= policy.maxOutstandingIntents ||
      capacity.total + input.reservedBytes > policy.maxGlobalBytes ||
      capacity.round + input.reservedBytes > policy.maxRoundBytes
    )
      throw createAppError(
        'RATE_LIMIT',
        'Necessary evidence capacity exhausted',
      );
  }
  const epoch = nextEpoch(
    existing?.executionEpoch ?? 0,
    'Evidence execution epoch exhausted',
  );
  const token = policy.nextToken();
  const digest = evidenceLeaseDigest(token);
  // Re-sample after admission queries: neither a wait nor token acquisition renews authority.
  const admittedAt = await freshCaptureMutation(tx, input.roundId, context);
  await requireCaptureSession(tx, input, {
    capturedUntil: new Date(input.after),
    receivedAt: admittedAt,
    sttLagMs: dependencies.sttLagMs,
  });
  const leaseExpiresAt = new Date(admittedAt.getTime() + policy.leaseMs);
  const claim = {
    executionWorkerId: input.workerId,
    executionEpoch: epoch,
    leaseDigest: digest,
    leaseExpiresAt,
    lastClaimedAt: admittedAt,
  };
  if (existing)
    await tx
      .update(necessaryEvidence)
      .set(claim)
      .where(
        and(
          eq(necessaryEvidence.id, input.evidenceId),
          eq(necessaryEvidence.executionEpoch, existing.executionEpoch),
        ),
      );
  else
    await tx.insert(necessaryEvidence).values({
      id: input.evidenceId,
      roundId: input.roundId,
      originalRoundId: input.roundId,
      originalSubjectActorIds: subjects,
      originalSpeaker: speaker,
      authorityId: input.authorityId,
      sessionId: input.sessionId,
      segmentId: input.segmentId,
      roundParticipantId: input.roundParticipantId,
      workerId: input.workerId,
      captureEpoch: input.epoch,
      bindingDigest: originalEvidenceBinding(input, subjects, speaker),
      reservedBytes: input.reservedBytes,
      createdAt: admittedAt,
      ...claim,
    });
  return {
    kind: 'claimed' as const,
    evidenceId: input.evidenceId,
    bindingDigest: originalEvidenceBinding(input, subjects, speaker),
    executionEpoch: epoch,
    token,
    leaseExpiresAt: leaseExpiresAt.toISOString(),
  };
}
