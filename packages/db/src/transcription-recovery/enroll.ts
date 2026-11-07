import { eq, sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import type { BoundedTransactionContext } from '../transaction-context';
import { lockOriginalEvidenceBody } from '../necessary-evidence-body';
import { necessaryEvidence } from '../schema/necessary-evidence';
import { sampleRoundExecutionTime } from '../round-execution-time';
import { register } from './register';
/** Application must authenticate the restored original body/current custody first. Never uses replacement capture rights. */
export async function enroll(tx: BoundedTransactionContext, raw: unknown) {
  const original = await lockOriginalEvidenceBody(tx, raw);
  // Existing subject/intent projection is deliberately payload-free; inspect presence without selecting ciphertext.
  const [row] = await tx
    .select({
      state: necessaryEvidence.state,
      payloadAcceptedAt: necessaryEvidence.payloadAcceptedAt,
      receivedAt: necessaryEvidence.receivedAt,
      expiresAt: necessaryEvidence.expiresAt,
      payloadPresent: sql<boolean>`${necessaryEvidence.ciphertext} is not null and ${necessaryEvidence.nonce} is not null and ${necessaryEvidence.tag} is not null`,
    })
    .from(necessaryEvidence)
    .where(eq(necessaryEvidence.id, original.body.evidenceId));
  const now = new Date(await sampleRoundExecutionTime(tx));
  if (
    !row ||
    row.state !== 'retained' ||
    !row.payloadAcceptedAt ||
    !row.payloadPresent ||
    !row.receivedAt ||
    !row.expiresAt ||
    row.receivedAt > now ||
    row.expiresAt <= now
  )
    throw createAppError('CONFLICT', 'Original payload is unavailable');
  await register(tx, original.body, original.row);
  return { kind: 'enrolled' as const, evidenceId: original.body.evidenceId };
}
