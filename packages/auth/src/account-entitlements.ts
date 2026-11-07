import type { EntitlementGrant } from '@daisy/protocol';
import {
  currentEntitlementGrants,
  type EntitlementEvaluation,
} from './entitlement-validity';

/**
 * DEC-247 and ISSUE-779: premium entitlements come from the account's own
 * grant facts, never from its beta state. Beta approval is one source of a
 * grant; `betaGrantsPremium` says whether a beta-sourced premium grant counts
 * (true in the beta, false at launch). These are entitlement facts, not
 * authorization: identity, participant admission and the caller's debating
 * seat are still evaluated separately. Each premium is its own named fact.
 */
export function accountEntitlements(
  grants: readonly EntitlementGrant[],
  policy: EntitlementEvaluation,
) {
  const current = currentEntitlementGrants(grants, policy);
  const holds = (entitlement: EntitlementGrant['entitlement']) =>
    current.some((grant) => grant.entitlement === entitlement);
  return {
    roundAnalysis: holds('round_analysis'),
    casualAiJudge: holds('casual_ai_judge'),
    casualCapture: holds('casual_capture'),
    recordingDownload: holds('recording_download'),
  };
}
