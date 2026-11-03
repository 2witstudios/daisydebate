import { accountEntitlements } from '@daisy/auth/authorization';
import type { EntitlementGrant } from '@daisy/protocol';

/**
 * A download takes WATCH-8's subscription entitlement, read here and granted
 * there. An absent grant is never a grant; a beta grant counts only while beta
 * grants premium, so launch ends it with no change here.
 */
export const holdsRecordingDownload =
  (deps: {
    readonly readGrants: (
      userId: string,
    ) => Promise<readonly EntitlementGrant[]>;
    readonly betaGrantsPremium: boolean;
  }) =>
  async (userId: string): Promise<boolean> =>
    accountEntitlements(await deps.readGrants(userId), {
      betaGrantsPremium: deps.betaGrantsPremium,
    }).casualCapture;
