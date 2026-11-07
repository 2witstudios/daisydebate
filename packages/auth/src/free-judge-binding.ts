import type { FreeBindingReleaseFacts } from '@daisy/protocol/billing';

/**
 * DEC-367. The store supplies these facts under the account and Round fences,
 * excluding concurrent judge admission/dispatch. Only an atomic release of
 * the entire selected, proven-undispatched bundle can retire its binding.
 * A timeout, provider refund or platform credit is never release evidence.
 */
export function canReleaseFreeJudgeBinding(
  facts: FreeBindingReleaseFacts,
): boolean {
  return (
    facts.boundRoundId === facts.roundId &&
    facts.abandoned &&
    facts.bot?.kind === 'released' &&
    (facts.judge.kind === 'unselected' ||
      (facts.judge.kind === 'selected' &&
        facts.judge.state.kind === 'released'))
  );
}
