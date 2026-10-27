import type { AuthorizationTransaction } from '../authorization';

import type { PrivacyFieldDeclaration } from '@daisy/protocol/privacy';

export type PrivacySubject = {
  readonly userId: string;
  readonly actorId: string;
};
export type PrivacyExport = Readonly<
  Record<string, readonly Readonly<Record<string, unknown>>[]>
>;

/**
 * Called only inside the caller's transaction, after the canonical user lock.
 * Export is restricted to this subject's declared exportable fields. Cleanup
 * removes subject-owned data and associations, never other authors' content.
 * An adopter must not open another transaction or call external services.
 */
export type PrivacyAdopter = {
  readonly id: string;
  readonly phase: 'before-auth' | 'after-scrub';
  readonly fields: readonly PrivacyFieldDeclaration[];
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
