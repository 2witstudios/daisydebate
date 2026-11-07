import { register as registerTranscriptionRecovery } from './transcription-recovery/register';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { createAppError } from '@daisy/errors';
import { evidenceEnvelopeSchema, idSchema } from '@daisy/protocol';
import { lockOriginalEvidenceBody } from './necessary-evidence-body';
import { evidenceLeaseDigest } from './necessary-evidence-policy';
import { sampleRoundExecutionTime } from './round-execution-time';
import type { CaptureTx } from './media-capture-context';
import { necessaryEvidence } from './schema/necessary-evidence';
const inputSchema = z.strictObject({
  body: z.unknown(),
  sealed: evidenceEnvelopeSchema,
  claim: z.strictObject({
    workerId: idSchema,
    executionEpoch: z.number().int().min(1).max(2147483647),
    token: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
  }),
});
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
  const { body, encoded, binding } = await lockOriginalEvidenceBody(
    tx,
    parsed.data.body,
  );
  const [row] = await tx
    .select()
    .from(necessaryEvidence)
    .where(eq(necessaryEvidence.id, body.evidenceId));
  if (
    !row ||
    sealed.receipt.bindingDigest !== binding ||
    sealed.receipt.evidenceId !== row.id ||
    sealed.ciphertext.byteLength !== encoded.byteLength
  )
    throw createAppError('CONFLICT');
  const admittedAt = new Date(await sampleRoundExecutionTime(tx));
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
    await registerTranscriptionRecovery(tx, body, row.payloadAcceptedAt, row);
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
  await registerTranscriptionRecovery(tx, body, admittedAt, row);
  return {
    kind: 'received' as const,
    evidenceId: row.id,
    bindingDigest: binding,
    payloadAcceptedAt: admittedAt.toISOString(),
    receipt: sealed.receipt,
  };
}
