import type {
  RoundAnalysisClaimDecision,
  RoundAnalysisFacts,
} from '@daisy/db/rounds';
import type { RoundAnalysisView } from '@daisy/protocol';

/**
 * Round analysis's own bounds (DEC-247): a seat is analysed only within the
 * window after its Round completes, and buys at most `maxCalls` paid calls.
 * Nothing here reads a ballot.
 */
export const roundAnalysisPolicy = {
  windowMs: 24 * 60 * 60 * 1000,
  maxCalls: 2,
} as const;
export type RoundAnalysisPolicy = typeof roundAnalysisPolicy;

/**
 * Whether a seat needs its analysis at `now`: its Round completed within
 * the window, with frozen lines to analyse.
 */
export function roundAnalysisNeeded(
  facts: RoundAnalysisFacts,
  now: string,
  policy: RoundAnalysisPolicy = roundAnalysisPolicy,
): boolean {
  if (facts.status !== 'completed' || facts.completedAt === null) return false;
  const age = Date.parse(now) - Date.parse(facts.completedAt);
  return age < policy.windowMs && facts.frozen && facts.lines > 0;
}

/** A held lease that has run out at `now`. */
const lapsed = (facts: RoundAnalysisFacts, now: string) =>
  facts.analysis?.status === 'leased' &&
  facts.analysis.leaseExpiresAt !== null &&
  Date.parse(facts.analysis.leaseExpiresAt) <= Date.parse(now);

/**
 * What a claim does with a seat: take its next paid attempt, end a lapsed
 * lease that may buy no more (spent, or no longer needed), or leave it.
 */
export function roundAnalysisClaimDecision(
  facts: RoundAnalysisFacts,
  now: string,
  policy: RoundAnalysisPolicy = roundAnalysisPolicy,
): RoundAnalysisClaimDecision {
  const { analysis } = facts;
  if (analysis && !lapsed(facts, now)) return 'skip';
  const needed = roundAnalysisNeeded(facts, now, policy);
  if (analysis && (analysis.attempts >= policy.maxCalls || !needed))
    return 'fail';
  return needed ? 'claim' : 'skip';
}

/**
 * An entitled debater's view of their own analysis: the report, pending
 * while an analysis is running or will run in this deployment, else
 * unavailable. A debater without the entitlement sees `locked`.
 */
export function roundAnalysisView(input: {
  readonly facts: RoundAnalysisFacts;
  readonly entitled: boolean;
  readonly now: string;
  /** Whether this deployment runs round analysis (ROUND_ANALYSIS_POLICY is set). */
  readonly enabled: boolean;
  readonly policy?: RoundAnalysisPolicy;
}): RoundAnalysisView {
  const { facts, now } = input;
  const policy = input.policy ?? roundAnalysisPolicy;
  if (!input.entitled) return { status: 'locked' };
  const { analysis } = facts;
  if (analysis?.status === 'succeeded' && analysis.report)
    return { status: 'ready', report: analysis.report };
  const runs = analysis
    ? analysis.status === 'leased' &&
      roundAnalysisClaimDecision(facts, now, policy) !== 'fail'
    : input.enabled && roundAnalysisNeeded(facts, now, policy);
  return { status: runs ? 'pending' : 'unavailable' };
}
