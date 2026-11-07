import { randomBytes } from 'node:crypto';
import type { EvidenceIngressFixture } from './necessary-evidence-ingress.test-support';
import { createNecessaryEvidenceIngress } from '../src/features/media-capture/necessary-evidence-ingress';
export const recognitionTestOptions = {
  leaseMs: 30000,
  quietMs: 500,
  maxAttempts: 2,
  retryBaseMs: 1000,
  model: 'test-model',
  qualityPolicyDigest: 'f'.repeat(64),
  nextToken: () => randomBytes(32).toString('base64url'),
};
/** Seed current work eligibility only; synthetic storage history is not played evidence or an application reopening a result. */
export async function readyRecognition(f: EvidenceIngressFixture) {
  const received = await createNecessaryEvidenceIngress({
    store: f.capture,
    custody: f.custody,
  }).receive(f.body);
  if (received.kind !== 'received')
    throw new Error('Original receipt fixture failed');
  await f.f
    .sql`update rounds set status='active',current_stage='awaiting_ballot',outcome=null,completed_at=null where id=${f.body.roundId}`;
  await f.f
    .sql`update transcription_recovery_contexts set status='queued' where round_id=${f.body.roundId}`;
  return f.f.store.createTranscriptionRecovery(recognitionTestOptions);
}
