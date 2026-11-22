import {
  decisionAudience,
  shouldReleaseRoundDecision,
  type DecisionReleasePolicy,
} from '@daisy/protocol/round-decision-release';

/** The Notifications application's default finalization selection. Effects remain atomic in storage. */
export const decisionRelease: DecisionReleasePolicy = {
  release: shouldReleaseRoundDecision,
  audience: decisionAudience,
};
