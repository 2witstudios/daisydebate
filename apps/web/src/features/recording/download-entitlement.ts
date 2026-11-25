import { accountEntitlements } from '@daisy/auth/authorization';
import type { EntitlementGrant } from '@daisy/protocol/entitlements';

/**
 * A download takes its own entitlement. An absent grant is never a grant; a beta grant counts only while beta
 * grants premium, so launch ends it with no change here.
 */
export const holdsRecordingDownload =
  (deps: {
    readonly readGrants: (
      userId: string,
    ) => Promise<readonly EntitlementGrant[]>;
    readonly betaGrantsPremium: boolean;
    readonly now: () => string;
  }) =>
  async (userId: string): Promise<boolean> =>
    accountEntitlements(await deps.readGrants(userId), {
      betaGrantsPremium: deps.betaGrantsPremium,
      now: deps.now(),
    }).recordingDownload;

/**
 * Whether the account holds the casual host's recording and broadcast
 * opt-ins (WATCH-8), read where a finished casual Round offers Premium.
 */
export const accountHoldsCasualCapture =
  (deps: Parameters<typeof holdsRecordingDownload>[0]) =>
  async (userId: string): Promise<boolean> =>
    accountEntitlements(await deps.readGrants(userId), {
      betaGrantsPremium: deps.betaGrantsPremium,
      now: deps.now(),
    }).casualCapture;
