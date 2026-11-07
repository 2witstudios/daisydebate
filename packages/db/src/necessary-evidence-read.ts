import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { createAppError } from '@daisy/errors';
import {
  canonicalCaptureEvidenceBody,
  evidenceEnvelopeSchema,
  idSchema,
} from '@daisy/protocol';
import type { EvidencePrivacyScope } from '@daisy/protocol';
import { lockOriginalEvidenceBody } from './necessary-evidence-body';
import { lockOriginalNecessaryEvidence } from './necessary-evidence-subjects';
import { requireRoundEvidenceOpen } from './necessary-evidence-rounds';
import { requireEvidenceFrontierOpen } from './necessary-evidence-frontier';
import { sampleRoundExecutionTime } from './round-execution-time';
import type { CaptureTx } from './media-capture-context';
import { necessaryEvidence } from './schema/necessary-evidence';
const bodyInput = z.strictObject({ body: z.unknown() });
const idInput = z.strictObject({ roundId: idSchema, evidenceId: idSchema });
type Row = typeof necessaryEvidence.$inferSelect;
async function sealedRow(
  tx: CaptureTx,
  evidenceId: string,
  privacyScope: EvidencePrivacyScope,
) {
  const [row] = await tx
    .select()
    .from(necessaryEvidence)
    .where(eq(necessaryEvidence.id, evidenceId));
  const now = new Date(await sampleRoundExecutionTime(tx));
  if (
    !row ||
    row.state !== 'retained' ||
    !row.payloadAcceptedAt ||
    !row.receivedAt ||
    !row.expiresAt ||
    row.receivedAt > now ||
    row.expiresAt <= now
  )
    throw createAppError('CONFLICT');
  const sealed = evidenceEnvelopeSchema.safeParse({
    kind: 'sealed',
    receipt: {
      evidenceId: row.id,
      bindingDigest: row.bindingDigest,
      authorityId: row.authorityId,
      receivedAtMs: row.receivedAt.getTime(),
      expiresAtMs: row.expiresAt.getTime(),
    },
    ciphertext: row.ciphertext,
    nonce: row.nonce,
    tag: row.tag,
  });
  if (!sealed.success) throw createAppError('CONFLICT');
  return {
    kind: 'received' as const,
    evidenceId,
    bindingDigest: row.bindingDigest,
    payloadAcceptedAt: row.payloadAcceptedAt.toISOString(),
    privacyScope,
    sealed: sealed.data,
  };
}
const scopeOf = (
  row: Pick<Row, 'originalRoundId' | 'originalSubjectActorIds'>,
): EvidencePrivacyScope => ({
  roundId: row.originalRoundId,
  subjectActorIds: row.originalSubjectActorIds!,
});
const knownEvidence = async (tx: CaptureTx, id: string) => {
  const [known] = await tx
    .select({ id: necessaryEvidence.id })
    .from(necessaryEvidence)
    .where(eq(necessaryEvidence.id, id));
  return known;
};
/** Private application read, never ordinary Round/realtime/worker discovery. Receipt is not a fresh play grant. */
export async function readCaptureEvidencePayload(tx: CaptureTx, raw: unknown) {
  const parsed = bodyInput.safeParse(raw);
  if (!parsed.success) throw createAppError('VALIDATION');
  const canonical = canonicalCaptureEvidenceBody(parsed.data.body);
  if (canonical.kind !== 'encoded') throw createAppError('VALIDATION');
  const evidenceId = canonical.body.evidenceId;
  if (!(await knownEvidence(tx, evidenceId)))
    return { kind: 'missing' as const, evidenceId };
  const original = await lockOriginalEvidenceBody(tx, canonical.body);
  const privacyScope = scopeOf(original.row);
  if (original.row.state === 'acquiring')
    return {
      kind: 'pending' as const,
      evidenceId,
      bindingDigest: original.binding,
      privacyScope,
    };
  return {
    ...(await sealedRow(tx, evidenceId, privacyScope)),
    bodyDigest: original.bodyDigest,
  };
}
/** Private encrypted load by identity. The application must decode and revalidate full original body authority before use. */
export async function loadCaptureEvidencePayload(tx: CaptureTx, raw: unknown) {
  const parsed = idInput.safeParse(raw);
  if (!parsed.success) throw createAppError('VALIDATION');
  const { roundId, evidenceId } = parsed.data;
  if (!(await knownEvidence(tx, evidenceId)))
    return { kind: 'missing' as const, evidenceId };
  const current = await lockOriginalNecessaryEvidence(tx, parsed.data);
  await requireRoundEvidenceOpen(tx, roundId);
  await requireEvidenceFrontierOpen(tx, roundId);
  if (current.row.state === 'acquiring')
    return { kind: 'pending' as const, evidenceId };
  return sealedRow(tx, evidenceId, scopeOf(current.row));
}
