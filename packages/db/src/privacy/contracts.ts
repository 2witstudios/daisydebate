import type { AuthorizationTransaction } from '../authorization';

/** When a step runs: before sign-in rows go, or after the account closes. */
export const privacyPhases = ['before-auth', 'after-close'] as const;

export type PrivacySubject = {
  readonly userId: string;
  readonly actorId: string;
};
export type PrivacyExport = Readonly<
  Record<string, readonly Readonly<Record<string, unknown>>[]>
>;

/**
 * One feature's part of a member's subject rights (docs/operations/compliance.md):
 * called only inside the caller's transaction, after the canonical user lock.
 * Export returns this subject's own rows. Erasure removes the feature's
 * private data and associations, never another author's content and never
 * the competitive record (ADR 0087). An adopter must not open another
 * transaction or call external services.
 */
export type PrivacyAdopter = {
  readonly id: string;
  readonly phase: (typeof privacyPhases)[number];
  readonly erase: (
    tx: AuthorizationTransaction,
    subject: PrivacySubject,
    context: { readonly now: string },
  ) => Promise<void>;
  readonly export: (
    tx: AuthorizationTransaction,
    subject: PrivacySubject,
  ) => Promise<PrivacyExport>;
};
