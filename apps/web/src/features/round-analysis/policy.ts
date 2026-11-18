import type { RoundAnalysisFacts } from '@daisy/db/rounds';
import {
  remainingAnalysisCalls,
  type RoundAnalysisView,
} from '@daisy/protocol';

/** Authorized stored content survives lapse; only a fresh request uses present allowance. */
export function roundAnalysisView(input: {
  readonly facts: RoundAnalysisFacts;
  readonly allowance: 'included' | 'free' | 'fair-use' | 'unavailable';
  readonly now: string;
  readonly enabled: boolean;
}): RoundAnalysisView {
  const { facts } = input;
  const work = facts.analysis;
  if (work && 'report' in work) return { status: 'ready', report: work.report };
  if (work?.kind === 'queued' || work?.kind === 'leased')
    return {
      status:
        Date.parse(input.now) < Date.parse(work.deadlineAt)
          ? 'pending'
          : 'unavailable',
    };
  if (work && work.kind !== 'unrequested') return { status: 'unavailable' };
  if (
    !input.enabled ||
    facts.status !== 'completed' ||
    facts.completedAt === null ||
    !facts.frozen ||
    facts.lines < 1 ||
    remainingAnalysisCalls(work) === 0
  )
    return { status: 'unavailable' };
  switch (input.allowance) {
    case 'unavailable':
      return { status: 'locked' };
    case 'fair-use':
      return { status: 'fair-use' };
    default:
      return { status: 'requestable', allowance: input.allowance };
  }
}
