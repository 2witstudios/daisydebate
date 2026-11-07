import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { createAppError } from '@daisy/errors';
import {
  canonicalCaptureEvidenceBody,
  evidenceEnvelopeSchema,
  idSchema,
} from '@daisy/protocol';
import type { CaptureEvidenceBody } from '@daisy/protocol';
import { originalEvidenceBinding } from './necessary-evidence-binding';
import { evidenceLeaseDigest } from './necessary-evidence-policy';
import { lockOriginalNecessaryEvidence } from './necessary-evidence-subjects';
import { requireRoundEvidenceOpen } from './necessary-evidence-rounds';
import { sampleRoundExecutionTime } from './round-execution-time';
import type { CaptureTx } from './media-capture-context';
import { necessaryEvidence } from './schema/necessary-evidence';
import { rounds } from './schema/rounds';
import { roundSegments } from './schema/round-segments';
import { roundSpeakingIntervals } from './schema/round-speaking-intervals';
import { roundTranscriptFreezes } from './schema/round-transcript-freezes';

const inputSchema = z.strictObject({
  body: z.unknown(),
  sealed: evidenceEnvelopeSchema,
  claim: z.strictObject({
    workerId: idSchema,
    executionEpoch: z.number().int().min(1).max(2147483647),
    token: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
  }),
});
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
/** Store boundary only. The owning application must authenticate ciphertext against the canonical body first. */
export async function adoptCaptureEvidencePayload(tx: CaptureTx, raw: unknown) {
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) throw createAppError('VALIDATION');
  const { claim } = parsed.data;
  // Snapshot bounded binary input before any account/row wait; the caller retains no mutable write handle.
  const sealed = {
    ...parsed.data.sealed,
    ciphertext: Uint8Array.from(parsed.data.sealed.ciphertext),
    nonce: Uint8Array.from(parsed.data.sealed.nonce),
    tag: Uint8Array.from(parsed.data.sealed.tag),
  };
  const encoded = canonicalCaptureEvidenceBody(parsed.data.body);
  if (encoded.kind !== 'encoded') throw createAppError('VALIDATION');
  const { body } = encoded;
  const bodyDigest = new Bun.CryptoHasher('sha3-256')
    .update(encoded.json)
    .digest('hex');
  await lockOriginalNecessaryEvidence(tx, {
    roundId: body.roundId,
    evidenceId: body.evidenceId,
  });
  await requireRoundEvidenceOpen(tx, body.roundId);
  // Only this payload-owning operation reads encrypted bytes, after canonical subject and row fences.
  const [row] = await tx
    .select()
    .from(necessaryEvidence)
    .where(eq(necessaryEvidence.id, body.evidenceId));
  if (!row) throw createAppError('CONFLICT');
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
  );
  if (
    binding !== row.bindingDigest ||
    sealed.receipt.bindingDigest !== binding ||
    sealed.receipt.evidenceId !== row.id ||
    sealed.ciphertext.byteLength !== encoded.byteLength ||
    row.reservedBytes !== encoded.byteLength ||
    row.workerId !== body.workerId ||
    row.captureEpoch !== body.epoch ||
    row.sessionId !== body.sessionId ||
    row.segmentId !== body.segmentId ||
    row.roundParticipantId !== body.roundParticipantId
  )
    throw createAppError('CONFLICT', 'Original evidence body differs');
  const [freeze] = await tx
    .select({ id: roundTranscriptFreezes.roundId })
    .from(roundTranscriptFreezes)
    .where(eq(roundTranscriptFreezes.roundId, body.roundId));
  if (freeze) throw createAppError('CONFLICT', 'Evidence frontier is frozen');
  let admittedAt = new Date(await sampleRoundExecutionTime(tx));
  await originalHistory(tx, body, admittedAt);
  admittedAt = new Date(await sampleRoundExecutionTime(tx));
  if (
    sealed.receipt.receivedAtMs > admittedAt.getTime() ||
    sealed.receipt.expiresAtMs <= admittedAt.getTime()
  )
    throw createAppError('CONFLICT', 'Original evidence receipt is ineligible');
  if (
    row.executionWorkerId !== claim.workerId ||
    row.executionEpoch !== claim.executionEpoch ||
    row.leaseDigest !== evidenceLeaseDigest(claim.token)
  )
    throw createAppError('CONFLICT', 'Evidence execution is stale');
  if (row.state === 'retained') {
    if (
      !row.payloadAcceptedAt ||
      row.authorityId !== sealed.receipt.authorityId ||
      row.receivedAt?.getTime() !== sealed.receipt.receivedAtMs ||
      row.expiresAt?.getTime() !== sealed.receipt.expiresAtMs ||
      !row.ciphertext ||
      !Buffer.from(row.ciphertext).equals(sealed.ciphertext) ||
      !row.nonce ||
      !Buffer.from(row.nonce).equals(sealed.nonce) ||
      !row.tag ||
      !Buffer.from(row.tag).equals(sealed.tag)
    )
      throw createAppError('CONFLICT', 'Payload confirmation differs');
    return {
      kind: 'received' as const,
      evidenceId: row.id,
      bindingDigest: binding,
      payloadAcceptedAt: row.payloadAcceptedAt.toISOString(),
      receipt: sealed.receipt,
    };
  }
  if (
    row.state !== 'acquiring' ||
    !row.leaseExpiresAt ||
    row.leaseExpiresAt <= admittedAt ||
    (row.expiresAt && row.expiresAt.getTime() !== sealed.receipt.expiresAtMs) ||
    (row.receivedAt &&
      row.receivedAt.getTime() !== sealed.receipt.receivedAtMs) ||
    (row.authorityId && row.authorityId !== sealed.receipt.authorityId)
  )
    throw createAppError('CONFLICT', 'Evidence execution is stale');
  await tx
    .update(necessaryEvidence)
    .set({
      state: 'retained',
      authorityId: sealed.receipt.authorityId,
      receivedAt: new Date(sealed.receipt.receivedAtMs),
      expiresAt: new Date(sealed.receipt.expiresAtMs),
      payloadAcceptedAt: admittedAt,
      ciphertext: sealed.ciphertext,
      nonce: sealed.nonce,
      tag: sealed.tag,
    })
    .where(eq(necessaryEvidence.id, row.id));
  return {
    kind: 'received' as const,
    evidenceId: row.id,
    bindingDigest: binding,
    payloadAcceptedAt: admittedAt.toISOString(),
    receipt: sealed.receipt,
  };
}
