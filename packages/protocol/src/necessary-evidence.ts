import type { CaptureEvidenceBody } from './capture-evidence-body';
import type { CaptureEvidenceSpeaker } from './capture-evidence-speaker';
import type { EvidencePrivacyScope } from './evidence-privacy';

/** Necessary evidence is not an optional Recording or a claim of peer hearing. */
export const necessaryEvidencePolicy = {
  maxAgeMs: 7 * 24 * 60 * 60 * 1000,
  maxPayloadBytes: 64 * 1024,
} as const;
export type EvidenceIdentity = {
  readonly evidenceId: string;
  /** Digest of original authority, sequence/calibration/history and payload. */
  readonly bindingDigest: string;
};
/** Original backing resource, fixed before any side-effectful key acquisition. */
export type EvidenceCustodyIdentity = EvidenceIdentity & {
  readonly authorityId: string;
};
/** Durable key reservation only: neither a PG audio receipt nor a hearing/coverage fact. */
export type EvidenceCustodyReceipt = EvidenceCustodyIdentity & {
  readonly receivedAtMs: number;
  readonly expiresAtMs: number;
};
export const evidenceRefusalReasons = [
  'unavailable',
  'uncertain',
  'revoked',
  'expired',
  'conflict',
  'invalid',
] as const;
export type EvidenceRefusal = {
  readonly kind: 'refused';
  readonly reason: (typeof evidenceRefusalReasons)[number];
};
export type SealedEvidence = {
  readonly kind: 'sealed';
  readonly receipt: EvidenceCustodyReceipt;
  readonly ciphertext: Uint8Array;
  readonly nonce: Uint8Array;
  readonly tag: Uint8Array;
};
/** No raw key or reusable decryptor crosses the custody boundary. */
export type NecessaryEvidenceCustody = {
  /** Backing identity only; never an attestation of complete/current privacy lineage. */
  readonly identify: () => Promise<
    | { readonly kind: 'identified'; readonly authorityId: string }
    | EvidenceRefusal
  >;
  readonly seal: (
    identity: EvidenceCustodyIdentity,
    plaintext: Uint8Array,
    privacyScope: EvidencePrivacyScope,
  ) => Promise<
    ({ readonly kind: 'sealed' } & SealedEvidence) | EvidenceRefusal
  >;
  /** Fresh current authority/material check; no reusable key/decryptor or caller currentness assertion. */
  readonly inspect: (
    identity: EvidenceCustodyIdentity,
    privacyScope: EvidencePrivacyScope,
  ) => Promise<
    | {
        readonly kind: 'available';
        readonly receipt: EvidenceCustodyReceipt;
        readonly payloadDigest: string;
      }
    | EvidenceRefusal
  >;
  readonly open: (
    evidence: SealedEvidence,
  ) => Promise<
    | { readonly kind: 'opened'; readonly plaintext: Uint8Array }
    | EvidenceRefusal
  >;
  /** Idempotent, including when acquisition/commit acknowledgement was lost. */
  readonly revoke: (
    identity: EvidenceCustodyIdentity,
  ) => Promise<{ readonly kind: 'revoked' } | EvidenceRefusal>;
};

/** Historical committed payload metadata; never fresh capture/publication/hearing permission. */
export type NecessaryEvidencePayloadReceipt = {
  readonly kind: 'received';
  readonly evidenceId: string;
  readonly bindingDigest: string;
  readonly payloadAcceptedAt: string;
  readonly receipt: EvidenceCustodyReceipt;
};
export type NecessaryEvidenceIngressReply =
  | NecessaryEvidencePayloadReceipt
  | EvidenceRefusal
  | { readonly kind: 'pending'; readonly evidenceId: string };

/** Private authenticated original read output. Never current dispatch, hearing or quality permission. */
export type NecessaryEvidenceRestoreReply =
  | {
      readonly kind: 'restored';
      readonly body: CaptureEvidenceBody;
      readonly speaker: CaptureEvidenceSpeaker;
      readonly receipt: NecessaryEvidencePayloadReceipt;
    }
  | Exclude<NecessaryEvidenceIngressReply, NecessaryEvidencePayloadReceipt>;
export type NecessaryEvidenceRestore = (
  input: unknown,
) => Promise<NecessaryEvidenceRestoreReply>;
