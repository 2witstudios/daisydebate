import {
  noticeOfConsentRole,
  roleOfConsentMethod,
  type ConsentMethod,
  type ConsentRole,
  type GuardianNoticeKind,
} from '@daisy/protocol/guardians';
import type { ServedNotice } from '../legal/guardian-notices';

/**
 * One person's agreement to one notice (ADR 0163): who, when, which notice
 * version, the digest of its exact words, and how. Written once and never
 * changed; the link it supports is a separate row.
 */
export type ConsentEvidence = {
  readonly id: string;
  readonly personUserId: string;
  readonly role: ConsentRole;
  readonly method: ConsentMethod;
  readonly noticeKind: GuardianNoticeKind;
  readonly noticeVersion: string;
  /** SHA3-256 of the notice's exact words, hex. */
  readonly noticeDigest: string;
  readonly recordedAt: string;
};

export type ConsentEvidenceDecision =
  | { readonly kind: 'refused'; readonly refusal: 'notice-changed' }
  | { readonly kind: 'recorded'; readonly evidence: ConsentEvidence };

/**
 * Records agreement to the notice in force. The person names the version
 * they were shown; when it is not the one in force the agreement is refused,
 * never recorded against words they did not see.
 */
export function recordConsent(input: {
  readonly id: string;
  readonly personUserId: string;
  readonly method: ConsentMethod;
  /** The notice in force for the method's role. */
  readonly notice: ServedNotice;
  /** The version the person was shown. */
  readonly shownVersion: string;
  readonly at: string;
}): ConsentEvidenceDecision {
  const role = roleOfConsentMethod(input.method);
  if (
    input.notice.kind !== noticeOfConsentRole(role) ||
    input.notice.version !== input.shownVersion
  )
    return { kind: 'refused', refusal: 'notice-changed' };
  return {
    kind: 'recorded',
    evidence: {
      id: input.id,
      personUserId: input.personUserId,
      role,
      method: input.method,
      noticeKind: input.notice.kind,
      noticeVersion: input.notice.version,
      noticeDigest: input.notice.digest,
      recordedAt: input.at,
    },
  };
}
