import type { ContentReportCreate, ContentReportReason } from '@daisy/protocol';
import {
  audienceAdmits,
  type AudienceLinkFacts,
} from '../audience-link/audience-link';

/**
 * Whose audience a target belongs to, as a named read-only input: the Round, how
 * it admits an audience, and whether the reporter is in its live room.
 */
export type ReportAudience = AudienceLinkFacts & {
  readonly roundId: string;
  readonly inLiveRoom: boolean;
};

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
      readonly audience: ReportAudience;
    }
  | {
      readonly kind: 'chat_message';
      readonly ownMessage: boolean;
      readonly audience: ReportAudience;
    }
  | {
      readonly kind: 'ballot_feedback';
      readonly feedbackIsForReporter: boolean;
    };

export type ReportRefusal = 'report-not-found' | 'report-not-eligible';

const eligibleFootage = (
  reason: ContentReportReason,
  facts: Extract<ReportTargetFacts, { kind: 'footage' }>,
): boolean => {
  if (reason === 'result_dispute') return facts.ranked && facts.reporterSeated;
  if (reason === 'integrity_concern') return facts.ranked;
  return true;
};

/**
 * Who may report what. Anyone with an account may report conduct. Only a seat
 * of a ranked Round disputes its result, and only the debater who received
 * ballot feedback may report it, with no other access to private feedback. A
 * target on a Round the reporter cannot reach, private or unlisted with no link
 * and no seat in it, answers exactly as a missing one does, before any other rule can tell them apart.
 */
export const reportRefusal = (
  report: ContentReportCreate,
  facts: ReportTargetFacts,
  presentedHashOf: (roundId: string) => string | null,
): ReportRefusal | null => {
  if (facts.kind === 'missing') return 'report-not-found';
  if (
    facts.kind !== 'ballot_feedback' &&
    !(facts.kind === 'footage' && facts.reporterSeated) &&
    !facts.audience.inLiveRoom &&
    !audienceAdmits(facts.audience, presentedHashOf(facts.audience.roundId))
  )
    return 'report-not-found';
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
