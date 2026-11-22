import { instantMs } from '@daisy/clock';
import type { RoundAnalysisFacts } from '@daisy/db/rounds';
import { remainingAnalysisCalls } from '@daisy/protocol/round-analysis-lifecycle';
import { type RoundAnalysisView } from '@daisy/protocol/round-analysis';

/** Authorized stored content survives lapse; only a fresh request uses present allowance. */
export function roundAnalysisView(input: {
  readonly facts: RoundAnalysisFacts;
  /** `used` is the spent free analysis; `unavailable` any other refusal. */
  readonly allowance: 'included' | 'free' | 'used' | 'fair-use' | 'unavailable';
  readonly now: string;
  readonly enabled: boolean;
}): RoundAnalysisView {
  const { facts } = input;
  const work = facts.analysis;
  if (work && 'report' in work) return { status: 'ready', report: work.report };
  if (work?.kind === 'queued' || work?.kind === 'leased')
    return {
      status:
        instantMs(input.now) < instantMs(work.deadlineAt)
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
    case 'used':
      return { status: 'locked' };
    case 'unavailable':
      return { status: 'unavailable' };
    case 'fair-use':
      return { status: 'fair-use' };
    case 'free':
    case 'included':
      return { status: 'requestable', allowance: input.allowance };
  }
}
