import { eq } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import type { CaptureDependencies, CaptureTx } from './media-capture-context';
import { lockOriginalNecessaryEvidence } from './necessary-evidence-subjects';
import { requireRoundEvidenceOpen } from './necessary-evidence-rounds';
import {
  evidenceLeaseDigest,
  evidencePolicyOf,
} from './necessary-evidence-policy';
import { nextEpoch } from './lease-policy';
import { sampleRoundExecutionTime } from './round-execution-time';
import { necessaryEvidence } from './schema/necessary-evidence';
/** Acquisition metadata only: no capture grant, PCM receipt, decryption or competitive write. */
export async function claimEvidenceAcquisition(
  tx: CaptureTx,
  input: {
    readonly roundId: string;
    readonly evidenceId: string;
    readonly workerId: string;
  },
  dependencies: CaptureDependencies,
) {
  const policy = evidencePolicyOf(dependencies);
  const current = await lockOriginalNecessaryEvidence(tx, input);
  if (current.original.state !== 'acquiring') throw createAppError('CONFLICT');
  await requireRoundEvidenceOpen(tx, input.roundId);
  const now = new Date(await sampleRoundExecutionTime(tx));
  if (current.row.expiresAt && current.row.expiresAt <= now)
    throw createAppError('CONFLICT', 'Original evidence expired');
  if (current.row.leaseExpiresAt && current.row.leaseExpiresAt > now)
    return {
      kind: 'pending' as const,
      evidenceId: input.evidenceId,
      retryAt: current.row.leaseExpiresAt.toISOString(),
      bindingDigest: current.original.bindingDigest,
    };
  const epoch = nextEpoch(
    current.row.executionEpoch,
    'Evidence execution epoch exhausted',
  );
  const token = policy.nextToken();
  const digest = evidenceLeaseDigest(token);
  const admittedAt = new Date(await sampleRoundExecutionTime(tx));
  if (current.row.expiresAt && current.row.expiresAt <= admittedAt)
    throw createAppError('CONFLICT', 'Original evidence expired');
  const leaseExpiresAt = new Date(admittedAt.getTime() + policy.leaseMs);
  await tx
    .update(necessaryEvidence)
    .set({
      executionWorkerId: input.workerId,
      executionEpoch: epoch,
      leaseDigest: digest,
      leaseExpiresAt,
      lastClaimedAt: admittedAt,
    })
    .where(eq(necessaryEvidence.id, input.evidenceId));
  return {
    kind: 'claimed' as const,
    purpose: 'reconcile-acquisition' as const,
    evidenceId: input.evidenceId,
    bindingDigest: current.original.bindingDigest,
    executionEpoch: epoch,
    token,
    leaseExpiresAt: leaseExpiresAt.toISOString(),
  };
}
