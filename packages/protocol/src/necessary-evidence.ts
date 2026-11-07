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
/** Durable key reservation only: neither a PG audio receipt nor a hearing/coverage fact. */
export type EvidenceCustodyReceipt = EvidenceIdentity & {
  readonly authorityId: string;
  readonly receivedAtMs: number;
  readonly expiresAtMs: number;
};
export type EvidenceRefusal = {
  readonly kind: 'refused';
  readonly reason:
    | 'unavailable'
    | 'uncertain'
    | 'revoked'
    | 'expired'
    | 'conflict'
    | 'invalid';
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
  readonly seal: (
    identity: EvidenceIdentity,
    plaintext: Uint8Array,
    privacyScope: EvidencePrivacyScope,
  ) => Promise<
    ({ readonly kind: 'sealed' } & SealedEvidence) | EvidenceRefusal
  >;
  /** Fresh current authority/material check; no reusable key/decryptor or caller currentness assertion. */
  readonly inspect: (
    identity: EvidenceIdentity,
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
    identity: EvidenceIdentity,
  ) => Promise<{ readonly kind: 'revoked' } | EvidenceRefusal>;
};
