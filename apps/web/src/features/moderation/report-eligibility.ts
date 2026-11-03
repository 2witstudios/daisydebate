import type { ReportCreate, ReportReason } from '@daisy/protocol';

/**
 * What the store read about a report's target, for this reporter. Absent or
 * unreadable is `missing`, so a report never reveals that a thing exists.
 */
export type ReportTargetFacts =
  | { readonly kind: 'missing' }
  | {
      /** A Round or a Recording of one. */
      readonly kind: 'footage';
      readonly ranked: boolean;
      readonly reporterSeated: boolean;
    }
  | { readonly kind: 'chat_message'; readonly ownMessage: boolean }
  | {
      readonly kind: 'ballot_feedback';
      readonly feedbackIsForReporter: boolean;
    };

export type ReportRefusal = 'report-not-found' | 'report-not-eligible';

const eligibleFootage = (
  reason: ReportReason,
  facts: Extract<ReportTargetFacts, { kind: 'footage' }>,
): boolean => {
  if (reason === 'result_dispute') return facts.ranked && facts.reporterSeated;
  if (reason === 'integrity_concern') return facts.ranked;
  return true;
};

/**
 * Who may report what. Anyone with an account may report conduct. Only a seat
 * of a ranked Round disputes its result, and only the debater who received
 * ballot feedback may report it, with no other access to private feedback.
 */
export const reportRefusal = (
  report: ReportCreate,
  facts: ReportTargetFacts,
): ReportRefusal | null => {
  if (facts.kind === 'missing') return 'report-not-found';
  switch (facts.kind) {
    case 'footage':
      return eligibleFootage(report.reason, facts)
        ? null
        : 'report-not-eligible';
    case 'chat_message':
      return facts.ownMessage ? 'report-not-eligible' : null;
    case 'ballot_feedback':
      return facts.feedbackIsForReporter ? null : 'report-not-found';
  }
};
