import { createHash } from 'node:crypto';
import { verifyFrameClockEvidence } from '@daisy/media/observation';
import {
  canonicalCaptureEvidenceBody,
  type EvidenceCustodyReceipt,
  type EvidencePrivacyScope,
  type EvidenceRefusal,
  type NecessaryEvidenceCustody,
  type SealedEvidence,
} from '@daisy/protocol';
export type PreparedEvidenceBody = Extract<
  ReturnType<typeof canonicalCaptureEvidenceBody>,
  { kind: 'encoded' }
> & { readonly digest: string };
const refused = (reason: EvidenceRefusal['reason']): EvidenceRefusal => ({
  kind: 'refused',
  reason,
});
export const evidenceBodyDigest = (bytes: string | Uint8Array) =>
  createHash('sha3-256').update(bytes).digest('hex');
const receiptEqual = (a: EvidenceCustodyReceipt, b: EvidenceCustodyReceipt) =>
  a.evidenceId === b.evidenceId &&
  a.bindingDigest === b.bindingDigest &&
  a.authorityId === b.authorityId &&
  a.receivedAtMs === b.receivedAtMs &&
  a.expiresAtMs === b.expiresAtMs;
export const sameSealedEvidence = (a: SealedEvidence, b: SealedEvidence) =>
  receiptEqual(a.receipt, b.receipt) &&
  Buffer.from(a.ciphertext).equals(b.ciphertext) &&
  Buffer.from(a.nonce).equals(b.nonce) &&
  Buffer.from(a.tag).equals(b.tag);
export function prepareEvidenceBody(raw: unknown): PreparedEvidenceBody | null {
  const encoded = canonicalCaptureEvidenceBody(raw);
  return encoded.kind === 'encoded' &&
    encoded.body.frames.every((frame) => verifyFrameClockEvidence(frame.clock))
    ? { ...encoded, digest: evidenceBodyDigest(encoded.json) }
    : null;
}
export function createEvidenceAuthentication(
  custody: NecessaryEvidenceCustody,
) {
  const currentCustody = async (
    encoded: PreparedEvidenceBody,
    sealed: SealedEvidence,
    scope: EvidencePrivacyScope,
  ): Promise<EvidenceRefusal | null> => {
    const current = await custody.inspect(sealed.receipt, scope);
    if (current.kind === 'refused') return current;
    return current.payloadDigest === encoded.digest &&
      receiptEqual(current.receipt, sealed.receipt)
      ? null
      : refused('conflict');
  };
  const authenticated = async (
    encoded: PreparedEvidenceBody,
    sealed: SealedEvidence,
    scope: EvidencePrivacyScope,
  ): Promise<EvidenceRefusal | null> => {
    const opened = await custody.open(sealed);
    if (opened.kind === 'refused') return opened;
    try {
      if (
        opened.plaintext.byteLength !== encoded.byteLength ||
        evidenceBodyDigest(opened.plaintext) !== encoded.digest
      )
        return refused('conflict');
    } finally {
      // This owned transient copy can be cleared; plaintext already held elsewhere cannot be recalled.
      opened.plaintext.fill(0);
    }
    return currentCustody(encoded, sealed, scope);
  };
  return { authenticated, currentCustody };
}
