import {
  daisyBallotFor,
  panelRuleFor,
  type RoundJudging,
  type RoundRules,
} from '@daisy/protocol';

/**
 * What a Round launched from Daisy's catalogue is judged on (TAB-6.11): the
 * Daisy ballot its outcome kind implies, decided by that ballot's panel rule.
 * It is frozen on the Round when it launches, even with no judge seated, so
 * the panel that completes the Round reads one frozen rule; a Round whose
 * outcome nobody decides has none.
 */
export const frozenJudgingFor = (
  rules: Pick<RoundRules, 'outcome'>,
): RoundJudging => {
  const ballot = daisyBallotFor(rules.outcome);
  return ballot ? { ballot, panel: panelRuleFor(ballot) } : null;
};
