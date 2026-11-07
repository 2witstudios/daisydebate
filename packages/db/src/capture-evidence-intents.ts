import { and, eq, sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import type { z } from 'zod';
import {
  captureDigest,
  type captureEvidenceIntentSchema,
} from './capture-input';
import { captureHistory } from './capture-history';
import { requireCapturedWindow } from './capture-rules';
import { nextEpoch, requireLeaseMs } from './lease-policy';
import {
  captureWriteContext,
  freshCaptureMutation,
  requireCaptureSession,
  type CaptureDependencies,
  type CaptureTx,
} from './media-capture-context';
import { necessaryEvidence } from './schema/necessary-evidence';
import { lockNecessaryEvidenceRound } from './necessary-evidence-subjects';

type Intent = z.infer<typeof captureEvidenceIntentSchema>;
const leaseDigest = (token: string) => {
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(token))
    throw createAppError('AUTHORIZATION');
  return new Bun.CryptoHasher('sha3-256').update(token).digest('hex');
};
const policyOf = (dependencies: CaptureDependencies) => {
  const policy = dependencies.evidence;
  if (!policy)
    throw createAppError(
      'INFRASTRUCTURE',
      'Necessary evidence is not configured',
    );
  requireLeaseMs(policy.leaseMs);
  if (
    !Number.isSafeInteger(policy.maxRoundBytes) ||
    policy.maxRoundBytes < 1 ||
    policy.maxRoundBytes > 32 * 1024 * 1024 ||
    !Number.isSafeInteger(policy.maxGlobalBytes) ||
    policy.maxGlobalBytes < policy.maxRoundBytes ||
    policy.maxGlobalBytes > 512 * 1024 * 1024 ||
    !Number.isSafeInteger(policy.maxOutstandingIntents) ||
    policy.maxOutstandingIntents < 1 ||
    policy.maxOutstandingIntents > 65536
  )
    throw createAppError('VALIDATION');
  return policy;
};
/** Binds server-validated original scope/window independently of the declared full-body digest. */
const originalBinding = (input: Intent, subjects: readonly string[]) =>
  captureDigest([
    'necessary-evidence@1',
    input.roundId,
    input.sessionId,
    input.segmentId,
    input.roundParticipantId,
    input.workerId,
    input.epoch,
    input.trackId,
    input.startOffsetMs,
    input.durationMs,
    input.before,
    input.after,
    input.bodyDigest,
    input.reservedBytes,
    subjects,
  ]);
const sameOriginal = (
  row: typeof necessaryEvidence.$inferSelect,
  input: Intent,
  subjects: readonly string[],
) =>
  row.originalRoundId === input.roundId &&
  row.sessionId === input.sessionId &&
  row.segmentId === input.segmentId &&
  row.roundParticipantId === input.roundParticipantId &&
  row.workerId === input.workerId &&
  row.captureEpoch === input.epoch &&
  JSON.stringify(row.originalSubjectActorIds) === JSON.stringify(subjects) &&
  row.bindingDigest === originalBinding(input, subjects) &&
  row.reservedBytes === input.reservedBytes;

/** Commits original authority and bounded crash discovery BEFORE custody has any side effect. */
export async function reserveCaptureEvidenceIntent(
  tx: CaptureTx,
  input: Intent,
  dependencies: CaptureDependencies,
) {
  const policy = policyOf(dependencies);
  const { subjects } = await lockNecessaryEvidenceRound(tx, input.roundId);
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
      !sameOriginal(existing, input, subjects) ||
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
  const digest = leaseDigest(token);
  // Re-sample after admission queries: neither a wait nor token acquisition renews authority.
  const admittedAt = await freshCaptureMutation(tx, input.roundId, context);
  await requireCaptureSession(tx, input, {
    capturedUntil: new Date(input.after),
    receivedAt: admittedAt,
    sttLagMs: dependencies.sttLagMs,
  });
  const leaseExpiresAt = new Date(admittedAt.getTime() + policy.leaseMs);
  const claim = {
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
      sessionId: input.sessionId,
      segmentId: input.segmentId,
      roundParticipantId: input.roundParticipantId,
      workerId: input.workerId,
      captureEpoch: input.epoch,
      bindingDigest: originalBinding(input, subjects),
      reservedBytes: input.reservedBytes,
      createdAt: admittedAt,
      ...claim,
    });
  return {
    kind: 'claimed' as const,
    evidenceId: input.evidenceId,
    bindingDigest: originalBinding(input, subjects),
    executionEpoch: epoch,
    token,
    leaseExpiresAt: leaseExpiresAt.toISOString(),
  };
}
